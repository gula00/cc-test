//! 流式健康检查命令

use crate::app_config::AppType;
use crate::commands::copilot::CopilotAuthState;
use crate::error::AppError;
use crate::services::stream_check::{
    HealthStatus, StreamCheckConfig, StreamCheckResult, StreamCheckService,
};
use crate::store::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::State;

/// 流式健康检查（单个供应商）
#[tauri::command]
pub async fn stream_check_provider(
    state: State<'_, AppState>,
    copilot_state: State<'_, CopilotAuthState>,
    app_type: AppType,
    provider_id: String,
) -> Result<StreamCheckResult, AppError> {
    let config = state.db.get_stream_check_config()?;

    let providers = state.db.get_all_providers(app_type.as_str())?;
    let provider = providers
        .get(&provider_id)
        .ok_or_else(|| AppError::Message(format!("供应商 {provider_id} 不存在")))?;

    let auth_override = resolve_copilot_auth_override(provider, &copilot_state).await?;
    let base_url_override = resolve_copilot_base_url_override(provider, &copilot_state).await?;
    let claude_api_format_override = resolve_claude_api_format_override(
        &app_type,
        provider,
        &config,
        &copilot_state,
        auth_override.as_ref(),
    )
    .await?;
    let result = StreamCheckService::check_with_retry(
        &app_type,
        provider,
        &config,
        auth_override,
        base_url_override,
        claude_api_format_override,
    )
    .await?;

    // 记录日志
    let _ =
        state
            .db
            .save_stream_check_log(&provider_id, &provider.name, app_type.as_str(), &result);

    Ok(result)
}

/// 批量流式健康检查
#[tauri::command]
pub async fn stream_check_all_providers(
    state: State<'_, AppState>,
    copilot_state: State<'_, CopilotAuthState>,
    app_type: AppType,
    proxy_targets_only: bool,
) -> Result<Vec<(String, StreamCheckResult)>, AppError> {
    let config = state.db.get_stream_check_config()?;
    let providers = state.db.get_all_providers(app_type.as_str())?;

    let mut results = Vec::new();
    let allowed_ids: Option<HashSet<String>> = if proxy_targets_only {
        let mut ids = HashSet::new();
        if let Ok(Some(current_id)) = state.db.get_current_provider(app_type.as_str()) {
            ids.insert(current_id);
        }
        if let Ok(queue) = state.db.get_failover_queue(app_type.as_str()) {
            for item in queue {
                ids.insert(item.provider_id);
            }
        }
        Some(ids)
    } else {
        None
    };

    for (id, provider) in providers {
        if let Some(ids) = &allowed_ids {
            if !ids.contains(&id) {
                continue;
            }
        }

        let auth_override = resolve_copilot_auth_override(&provider, &copilot_state).await?;
        let base_url_override =
            resolve_copilot_base_url_override(&provider, &copilot_state).await?;
        let claude_api_format_override = resolve_claude_api_format_override(
            &app_type,
            &provider,
            &config,
            &copilot_state,
            auth_override.as_ref(),
        )
        .await
        .unwrap_or_else(|e| {
            log::warn!(
                "[StreamCheck] Failed to resolve Claude API format override for {}: {}",
                provider.id,
                e
            );
            None
        });
        let result = StreamCheckService::check_with_retry(
            &app_type,
            &provider,
            &config,
            auth_override,
            base_url_override,
            claude_api_format_override,
        )
        .await
        .unwrap_or_else(|e| {
            let (http_status, message) = match &e {
                crate::error::AppError::HttpStatus { status, .. } => (
                    Some(*status),
                    StreamCheckService::classify_http_status(*status).to_string(),
                ),
                _ => (None, e.to_string()),
            };
            StreamCheckResult {
                status: HealthStatus::Failed,
                success: false,
                message,
                response_time_ms: None,
                http_status,
                model_used: String::new(),
                tested_at: chrono::Utc::now().timestamp(),
                retry_count: 0,
                error_category: None,
            }
        });

        let _ = state
            .db
            .save_stream_check_log(&id, &provider.name, app_type.as_str(), &result);

        results.push((id, result));
    }

    Ok(results)
}

/// 获取流式检查配置
#[tauri::command]
pub fn get_stream_check_config(state: State<'_, AppState>) -> Result<StreamCheckConfig, AppError> {
    state.db.get_stream_check_config()
}

/// 保存流式检查配置
#[tauri::command]
pub fn save_stream_check_config(
    state: State<'_, AppState>,
    config: StreamCheckConfig,
) -> Result<(), AppError> {
    state.db.save_stream_check_config(&config)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ipv4CodexPromptTestResult {
    pub model_used: String,
    pub response_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Ipv4ModelCandidate {
    id: String,
    owned_by: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn test_ipv4_codex_prompt(
    ipv4: String,
    api_key: String,
    config: StreamCheckConfig,
    #[allow(non_snake_case)] overrideModel: Option<String>,
) -> Result<Ipv4CodexPromptTestResult, AppError> {
    let target = ipv4.trim();
    if target.is_empty() {
        return Err(AppError::Message("IPv4 is required".to_string()));
    }

    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(AppError::Message("API Key is required".to_string()));
    }

    let prompt = config.test_prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::Message("Test prompt is required".to_string()));
    }

    let requested_model = overrideModel
        .as_deref()
        .unwrap_or(config.codex_model.trim());
    let (configured_model, reasoning_effort) = parse_model_with_effort(requested_model);

    if configured_model.is_empty() {
        return Err(AppError::Message("Codex test model is required".to_string()));
    }

    let model_used = resolve_ipv4_test_model(target, api_key, &configured_model, config.timeout_secs)
        .await
        .unwrap_or(configured_model);

    let mut body = json!({
        "model": model_used,
        "input": [{ "role": "user", "content": prompt }],
        "stream": false
    });

    if let Some(effort) = reasoning_effort {
        body["reasoning"] = json!({ "effort": effort });
    }

    let client = crate::proxy::http_client::get();
    let timeout = std::time::Duration::from_secs(config.timeout_secs);
    let urls = [
        format!("http://{target}:8317/responses"),
        format!("http://{target}:8317/v1/responses"),
    ];

    for (index, url) in urls.iter().enumerate() {
        let response = client
            .post(url)
            .header("authorization", format!("Bearer {api_key}"))
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .header("accept-encoding", "identity")
            .header(
                "user-agent",
                format!(
                    "codex_cli_rs/0.80.0 ({} 15.7.2; {}) Terminal",
                    os_name(),
                    arch_name()
                ),
            )
            .header("originator", "codex_cli_rs")
            .timeout(timeout)
            .json(&body)
            .send()
            .await
            .map_err(map_request_error)?;

        let status = response.status().as_u16();
        let response_text = response.text().await.unwrap_or_default();

        if !(200..300).contains(&status) {
            if index == 0 && status == 404 {
                continue;
            }
            return Err(http_status_error(status, response_text));
        }

        let parsed: Value = serde_json::from_str(&response_text)
            .map_err(|e| AppError::Message(format!("Failed to parse response JSON: {e}")))?;

        return Ok(Ipv4CodexPromptTestResult {
            model_used,
            response_text: extract_response_text(&parsed).unwrap_or(response_text),
        });
    }

    Err(AppError::Message(
        "No valid Codex responses endpoint found".to_string(),
    ))
}

async fn resolve_ipv4_test_model(
    target: &str,
    api_key: &str,
    configured_model: &str,
    timeout_secs: u64,
) -> Result<String, AppError> {
    let available_models = fetch_ipv4_models(target, api_key, timeout_secs).await?;
    if available_models.is_empty() {
        return Ok(configured_model.to_string());
    }

    let has_gpt = available_models.iter().any(is_gpt_model);
    if has_gpt {
        return Ok(configured_model.to_string());
    }

    if let Some(google_model) = available_models.iter().find(|model| is_google_model(model)) {
        return Ok(google_model.id.clone());
    }

    Ok(configured_model.to_string())
}

async fn fetch_ipv4_models(
    target: &str,
    api_key: &str,
    timeout_secs: u64,
) -> Result<Vec<Ipv4ModelCandidate>, AppError> {
    let client = crate::proxy::http_client::get();
    let timeout = std::time::Duration::from_secs(timeout_secs);
    let urls = [
        format!("http://{target}:8317/v1/models"),
        format!("http://{target}:8317/models"),
    ];

    for (index, url) in urls.iter().enumerate() {
        let response = client
            .get(url)
            .header("authorization", format!("Bearer {api_key}"))
            .header("accept", "application/json")
            .header("accept-encoding", "identity")
            .timeout(timeout)
            .send()
            .await
            .map_err(map_request_error)?;

        let status = response.status().as_u16();
        let response_text = response.text().await.unwrap_or_default();

        if !(200..300).contains(&status) {
            if index == 0 && status == 404 {
                continue;
            }
            return Err(http_status_error(status, response_text));
        }

        let parsed: Value = serde_json::from_str(&response_text)
            .map_err(|e| AppError::Message(format!("Failed to parse models JSON: {e}")))?;
        return Ok(extract_model_candidates(&parsed));
    }

    Ok(Vec::new())
}

fn parse_model_with_effort(model: &str) -> (String, Option<String>) {
    if let Some(pos) = model.find('@').or_else(|| model.find('#')) {
        let actual_model = model[..pos].trim().to_string();
        let effort = model[pos + 1..].trim().to_string();
        if !effort.is_empty() {
            return (actual_model, Some(effort));
        }
        return (actual_model, None);
    }

    (model.trim().to_string(), None)
}

fn extract_model_candidates(value: &Value) -> Vec<Ipv4ModelCandidate> {
    value
        .get("data")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id").and_then(|id| id.as_str())?.trim().to_string();
                    if id.is_empty() {
                        return None;
                    }

                    let owned_by = item
                        .get("owned_by")
                        .and_then(|owner| owner.as_str())
                        .map(|owner| owner.trim().to_string())
                        .filter(|owner| !owner.is_empty());

                    Some(Ipv4ModelCandidate { id, owned_by })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn is_gpt_model(model: &Ipv4ModelCandidate) -> bool {
    model.id.to_ascii_lowercase().contains("gpt")
}

fn is_google_model(model: &Ipv4ModelCandidate) -> bool {
    let model_id = model.id.to_ascii_lowercase();
    let owned_by = model
        .owned_by
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();

    owned_by.contains("google")
        || owned_by.contains("antigravity")
        || model_id.contains("google")
        || model_id.contains("gemini")
        || model_id.contains("gemma")
}

fn extract_response_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(|v| v.as_str()) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    let output = value.get("output")?.as_array()?;
    let mut texts = Vec::new();

    for item in output {
        let Some(content) = item.get("content").and_then(|v| v.as_array()) else {
            continue;
        };

        for part in content {
            if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    texts.push(trimmed.to_string());
                }
            }
        }
    }

    if texts.is_empty() {
        None
    } else {
        Some(texts.join("\n\n"))
    }
}

fn map_request_error(e: reqwest::Error) -> AppError {
    if e.is_timeout() {
        AppError::Message("Request timeout".to_string())
    } else if e.is_connect() {
        AppError::Message(format!("Connection failed: {e}"))
    } else {
        AppError::Message(e.to_string())
    }
}

fn http_status_error(status: u16, body: String) -> AppError {
    let body = if body.len() > 400 {
        body.chars().take(400).collect::<String>()
    } else {
        body
    };
    AppError::Message(format!("HTTP {status}: {body}"))
}

fn os_name() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        other => other,
    }
}

fn arch_name() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "x86",
        other => other,
    }
}

async fn resolve_copilot_auth_override(
    provider: &crate::provider::Provider,
    copilot_state: &State<'_, CopilotAuthState>,
) -> Result<Option<crate::proxy::providers::AuthInfo>, AppError> {
    let is_copilot = is_copilot_provider(provider);

    if !is_copilot {
        return Ok(None);
    }

    let auth_manager = copilot_state.0.read().await;
    let account_id = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.managed_account_id_for("github_copilot"));

    let token = match account_id.as_deref() {
        Some(id) => auth_manager
            .get_valid_token_for_account(id)
            .await
            .map_err(|e| AppError::Message(format!("GitHub Copilot 认证失败: {e}")))?,
        None => auth_manager
            .get_valid_token()
            .await
            .map_err(|e| AppError::Message(format!("GitHub Copilot 认证失败: {e}")))?,
    };

    Ok(Some(crate::proxy::providers::AuthInfo::new(
        token,
        crate::proxy::providers::AuthStrategy::GitHubCopilot,
    )))
}

async fn resolve_copilot_base_url_override(
    provider: &crate::provider::Provider,
    copilot_state: &State<'_, CopilotAuthState>,
) -> Result<Option<String>, AppError> {
    let is_copilot = is_copilot_provider(provider);
    let is_full_url = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.is_full_url)
        .unwrap_or(false);

    if !is_copilot || is_full_url {
        return Ok(None);
    }

    let auth_manager = copilot_state.0.read().await;
    let account_id = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.managed_account_id_for("github_copilot"));

    let endpoint = match account_id.as_deref() {
        Some(id) => auth_manager.get_api_endpoint(id).await,
        None => auth_manager.get_default_api_endpoint().await,
    };

    Ok(Some(endpoint))
}

fn is_copilot_provider(provider: &crate::provider::Provider) -> bool {
    provider
        .meta
        .as_ref()
        .and_then(|meta| meta.provider_type.as_deref())
        == Some("github_copilot")
        || provider
            .settings_config
            .pointer("/env/ANTHROPIC_BASE_URL")
            .and_then(|value| value.as_str())
            .map(|url| url.contains("githubcopilot.com"))
            .unwrap_or(false)
}

async fn resolve_claude_api_format_override(
    app_type: &AppType,
    provider: &crate::provider::Provider,
    config: &StreamCheckConfig,
    copilot_state: &State<'_, CopilotAuthState>,
    auth_override: Option<&crate::proxy::providers::AuthInfo>,
) -> Result<Option<String>, AppError> {
    if *app_type != AppType::Claude {
        return Ok(None);
    }

    let is_copilot = auth_override
        .map(|auth| auth.strategy == crate::proxy::providers::AuthStrategy::GitHubCopilot)
        .unwrap_or(false);
    if !is_copilot {
        return Ok(None);
    }

    let model_id = StreamCheckService::resolve_effective_test_model(app_type, provider, config);
    let auth_manager = copilot_state.0.read().await;
    let account_id = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.managed_account_id_for("github_copilot"));

    let vendor_result = match account_id.as_deref() {
        Some(id) => {
            auth_manager
                .get_model_vendor_for_account(id, &model_id)
                .await
        }
        None => auth_manager.get_model_vendor(&model_id).await,
    };

    let api_format = match vendor_result {
        Ok(Some(vendor)) if vendor.eq_ignore_ascii_case("openai") => "openai_responses",
        Ok(Some(_)) | Ok(None) => "openai_chat",
        Err(err) => {
            log::warn!(
                "[StreamCheck] Failed to resolve Copilot model vendor for {model_id}: {err}. Falling back to chat/completions"
            );
            "openai_chat"
        }
    };

    Ok(Some(api_format.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        extract_model_candidates, is_copilot_provider, is_google_model, is_gpt_model,
        Ipv4ModelCandidate,
    };
    use crate::provider::{Provider, ProviderMeta};
    use serde_json::json;

    #[test]
    fn copilot_provider_detection_accepts_provider_type_or_base_url() {
        let typed_provider = Provider {
            id: "p1".to_string(),
            name: "typed".to_string(),
            settings_config: json!({}),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: Some(ProviderMeta {
                provider_type: Some("github_copilot".to_string()),
                ..Default::default()
            }),
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };
        assert!(is_copilot_provider(&typed_provider));

        let url_provider = Provider {
            id: "p2".to_string(),
            name: "url".to_string(),
            settings_config: json!({
                "env": {
                    "ANTHROPIC_BASE_URL": "https://api.githubcopilot.com"
                }
            }),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: None,
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };
        assert!(is_copilot_provider(&url_provider));
    }

    #[test]
    fn copilot_full_url_metadata_is_available_for_override_guard() {
        let provider = Provider {
            id: "p3".to_string(),
            name: "relay".to_string(),
            settings_config: json!({}),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: Some(ProviderMeta {
                provider_type: Some("github_copilot".to_string()),
                is_full_url: Some(true),
                ..Default::default()
            }),
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };

        assert!(is_copilot_provider(&provider));
        assert_eq!(
            provider.meta.as_ref().and_then(|meta| meta.is_full_url),
            Some(true)
        );
    }

    #[test]
    fn extract_model_candidates_reads_openai_models_payload() {
        let payload = json!({
            "data": [
                { "id": "gpt-5.4", "owned_by": "openai" },
                { "id": "Gemma 4 31B IT", "owned_by": "google" }
            ]
        });

        assert_eq!(
            extract_model_candidates(&payload),
            vec![
                Ipv4ModelCandidate {
                    id: "gpt-5.4".to_string(),
                    owned_by: Some("openai".to_string())
                },
                Ipv4ModelCandidate {
                    id: "Gemma 4 31B IT".to_string(),
                    owned_by: Some("google".to_string())
                }
            ]
        );
    }

    #[test]
    fn model_family_helpers_detect_gpt_and_google() {
        let gpt = Ipv4ModelCandidate {
            id: "gpt-5.4".to_string(),
            owned_by: Some("openai".to_string()),
        };
        let google_owned_gemma = Ipv4ModelCandidate {
            id: "Gemma 4 31B IT".to_string(),
            owned_by: Some("google".to_string()),
        };
        let gemini = Ipv4ModelCandidate {
            id: "gemini-2.0-flash".to_string(),
            owned_by: None,
        };
        let antigravity = Ipv4ModelCandidate {
            id: "claude-sonnet-4-6".to_string(),
            owned_by: Some("antigravity".to_string()),
        };
        let claude = Ipv4ModelCandidate {
            id: "claude-sonnet-4".to_string(),
            owned_by: Some("anthropic".to_string()),
        };

        assert!(is_gpt_model(&gpt));
        assert!(!is_gpt_model(&google_owned_gemma));
        assert!(is_google_model(&google_owned_gemma));
        assert!(is_google_model(&gemini));
        assert!(is_google_model(&antigravity));
        assert!(!is_google_model(&claude));
    }
}
