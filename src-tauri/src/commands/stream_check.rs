//! 流式健康检查命令

use crate::app_config::AppType;
use crate::commands::copilot::CopilotAuthState;
use crate::error::AppError;
use crate::proxy::providers::get_adapter;
use crate::services::ipv4_test::{
    arch_name, extract_response_text, http_status_error, map_request_error, os_name,
    parse_model_with_effort, resolve_codex_responses_urls, resolve_ipv4_test_model,
};
use crate::services::stream_check::{
    HealthStatus, StreamCheckConfig, StreamCheckResult, StreamCheckService,
};
use crate::store::AppState;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashSet;
use tauri::State;

/// 流式健康检查（单个供应商）
#[tauri::command]
pub async fn stream_check_provider(
    state: State<'_, AppState>,
    copilot_state: State<'_, CopilotAuthState>,
    app_type: AppType,
    provider_id: String,
    override_model: Option<String>,
) -> Result<StreamCheckResult, AppError> {
    let config = state.db.get_stream_check_config()?;
    let override_model = override_model
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_string);

    let providers = state.db.get_all_providers(app_type.as_str())?;
    let provider = providers
        .get(&provider_id)
        .ok_or_else(|| AppError::Message(format!("供应商 {provider_id} 不存在")))?;

    let mut provider_for_check = provider.clone();
    if let Some(model) = override_model {
        let meta = provider_for_check
            .meta
            .get_or_insert_with(crate::provider::ProviderMeta::default);
        let mut test_config = meta.test_config.clone().unwrap_or_default();
        test_config.enabled = true;
        test_config.test_model = Some(model);
        meta.test_config = Some(test_config);
    }

    let auth_override = resolve_copilot_auth_override(&provider_for_check, &copilot_state).await?;
    let base_url_override =
        resolve_copilot_base_url_override(&provider_for_check, &copilot_state).await?;
    let claude_api_format_override = resolve_claude_api_format_override(
        &app_type,
        &provider_for_check,
        &config,
        &copilot_state,
        auth_override.as_ref(),
    )
    .await?;
    let result = StreamCheckService::check_with_retry(
        &app_type,
        &provider_for_check,
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
                crate::error::AppError::HttpStatus { status, body } => {
                    (Some(*status), format!("HTTP {status}: {body}"))
                }
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPromptTestResult {
    pub model_used: String,
    pub response_text: String,
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
        return Err(AppError::Message(
            "Codex test model is required".to_string(),
        ));
    }

    let model_used =
        resolve_ipv4_test_model(target, api_key, &configured_model, config.timeout_secs)
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

#[tauri::command(rename_all = "camelCase")]
pub async fn test_provider_prompt(
    state: State<'_, AppState>,
    copilot_state: State<'_, CopilotAuthState>,
    app_type: AppType,
    provider_id: String,
    #[allow(non_snake_case)] overrideModel: Option<String>,
) -> Result<ProviderPromptTestResult, AppError> {
    if app_type != AppType::Codex && app_type != AppType::Claude {
        return Err(AppError::Message(
            "Provider prompt test currently supports Codex and Claude providers only".to_string(),
        ));
    }

    let config = state.db.get_stream_check_config()?;
    let providers = state.db.get_all_providers(app_type.as_str())?;
    let provider = providers
        .get(&provider_id)
        .ok_or_else(|| AppError::Message(format!("Provider {provider_id} not found")))?;

    let prompt = config.test_prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::Message("Test prompt is required".to_string()));
    }

    let requested_model = overrideModel
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            StreamCheckService::resolve_effective_test_model(&app_type, provider, &config)
        });
    let adapter = get_adapter(&app_type);
    let base_url = adapter
        .extract_base_url(provider)
        .map_err(|e| AppError::Message(format!("Failed to extract base_url: {e}")))?;
    let mut auth = adapter
        .extract_auth(provider)
        .ok_or_else(|| AppError::Message("API Key not found".to_string()))?;
    let base_url = resolve_copilot_base_url_override(provider, &copilot_state)
        .await?
        .unwrap_or(base_url);

    if let Some(auth_override) = resolve_copilot_auth_override(provider, &copilot_state).await? {
        auth = auth_override;
    }

    if app_type == AppType::Claude {
        let claude_api_format_override = resolve_claude_api_format_override(
            &app_type,
            provider,
            &config,
            &copilot_state,
            Some(&auth),
        )
        .await?;
        let result = StreamCheckService::test_claude_prompt(
            &base_url,
            &auth,
            &requested_model,
            prompt,
            std::time::Duration::from_secs(config.timeout_secs),
            provider,
            claude_api_format_override.as_deref(),
        )
        .await;

        let result = match result {
            Err(AppError::HttpStatus { status, body })
                if requested_model.trim() == "opus-6"
                    && StreamCheckService::detect_error_category(status, &body)
                        == Some("modelNotFound") =>
            {
                StreamCheckService::test_claude_prompt(
                    &base_url,
                    &auth,
                    "mimo-v2.5-pro",
                    prompt,
                    std::time::Duration::from_secs(config.timeout_secs),
                    provider,
                    claude_api_format_override.as_deref(),
                )
                .await?
            }
            other => other?,
        };

        return Ok(ProviderPromptTestResult {
            model_used: result.0,
            response_text: result.1,
        });
    }

    let (model_used, reasoning_effort) = parse_model_with_effort(&requested_model);

    if model_used.is_empty() {
        return Err(AppError::Message(
            "Codex test model is required".to_string(),
        ));
    }

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
    let urls = resolve_codex_responses_urls(&base_url, provider);

    for (index, url) in urls.iter().enumerate() {
        let response = client
            .post(url)
            .header("authorization", format!("Bearer {}", auth.api_key))
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
            if index == 0 && status == 404 && urls.len() > 1 {
                continue;
            }
            return Err(http_status_error(status, response_text));
        }

        let parsed: Value = serde_json::from_str(&response_text)
            .map_err(|e| AppError::Message(format!("Failed to parse response JSON: {e}")))?;

        return Ok(ProviderPromptTestResult {
            model_used,
            response_text: extract_response_text(&parsed).unwrap_or(response_text),
        });
    }

    Err(AppError::Message(
        "No valid Codex responses endpoint found".to_string(),
    ))
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
    use super::is_copilot_provider;
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
}
