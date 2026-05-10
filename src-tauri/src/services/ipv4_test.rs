use crate::error::AppError;
use crate::provider::Provider;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ipv4ModelCandidate {
    pub id: String,
    pub owned_by: Option<String>,
}

pub async fn resolve_ipv4_test_model(
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

pub fn parse_model_with_effort(model: &str) -> (String, Option<String>) {
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

pub fn resolve_codex_responses_urls(base_url: &str, provider: &Provider) -> Vec<String> {
    let is_full_url = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.is_full_url)
        .unwrap_or(false);
    if is_full_url {
        return vec![base_url.to_string()];
    }

    let base = base_url.trim_end_matches('/');
    if base.ends_with("/v1") {
        vec![format!("{base}/responses")]
    } else {
        vec![format!("{base}/responses"), format!("{base}/v1/responses")]
    }
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

pub fn extract_response_text(value: &Value) -> Option<String> {
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

pub fn map_request_error(e: reqwest::Error) -> AppError {
    if e.is_timeout() {
        AppError::Message("Request timeout".to_string())
    } else if e.is_connect() {
        AppError::Message(format!("Connection failed: {e}"))
    } else {
        AppError::Message(e.to_string())
    }
}

pub fn http_status_error(status: u16, body: String) -> AppError {
    let body = if body.len() > 400 {
        body.chars().take(400).collect::<String>()
    } else {
        body
    };
    AppError::Message(format!("HTTP {status}: {body}"))
}

pub fn os_name() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        other => other,
    }
}

pub fn arch_name() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "x86",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        extract_model_candidates, is_google_model, is_gpt_model, resolve_codex_responses_urls,
        Ipv4ModelCandidate,
    };
    use crate::provider::{Provider, ProviderMeta};
    use serde_json::json;

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

    #[test]
    fn resolve_codex_responses_urls_respects_full_url_flag() {
        let full_url_provider = Provider {
            id: "p1".to_string(),
            name: "relay".to_string(),
            settings_config: json!({}),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: Some(ProviderMeta {
                is_full_url: Some(true),
                ..Default::default()
            }),
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };

        assert_eq!(
            resolve_codex_responses_urls("https://example.com/custom", &full_url_provider),
            vec!["https://example.com/custom".to_string()]
        );
    }
}
