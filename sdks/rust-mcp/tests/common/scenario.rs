use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolScenario {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Map<String, Value>>,
    pub args: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum HandlerSpec {
    #[serde(rename = "respond")]
    Respond {
        data: Value,
        options: Option<Value>,
        emit: Option<Vec<Value>>,
    },
    #[serde(rename = "gate")]
    Gate { reason: Option<String> },
    #[serde(rename = "throw")]
    Throw { message: String },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Scenario {
    pub tool: ToolScenario,
    pub product: String,
    pub customer_ref: String,
    pub customer_ref_source: String,
    pub usage_type: Option<String>,
    pub limits: Value,
    pub handler: HandlerSpec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UsageProjection {
    pub outcome: String,
    pub action_type: String,
    pub units: f64,
    pub product_ref: String,
    pub customer_ref: String,
    pub metadata: serde_json::Map<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Observation {
    pub tool_result: Value,
    pub usage: Vec<UsageProjection>,
}

pub fn parse_scenario(args: Value) -> Scenario {
    serde_json::from_value(args).expect("scenario")
}

pub fn parse_observation(result: Value) -> Observation {
    serde_json::from_value(result).expect("observation")
}
