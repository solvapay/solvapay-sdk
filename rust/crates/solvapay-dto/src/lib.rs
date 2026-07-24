// @generated — do not edit. Regenerate with: pnpm gen

//! Generated SolvaPay wire DTOs from `contract/openapi/sdk-v1.snapshot.json`.
//!
//! Do not hand-edit. Regenerate via `dto-gen`.

pub mod error_templates;
pub mod overlays;
pub mod routes;
pub mod schemas;

pub use overlays::*;
pub use routes::{match_route, path_matches_template, roundtrip_response, RouteMatch};
// `OneTimePurchaseInfo`: crate root → overlays (wire: schemas::OneTimePurchaseInfo)
// `ProcessPaymentResult`: crate root → overlays (wire: schemas::ProcessPaymentResult)
pub use schemas::{
    ActivatePlanDto, ActivatePlanResponseDto, ActivatePlanResponseDtoStatus, AutoRechargeConfigDto,
    AutoRechargeConfigDtoFundingSourceType, AutoRechargeConfigDtoStatus, AutoRechargeDisplayDto,
    AutoRechargeDisplayFormattedDto, AutoRechargeGetResponse, AutoRechargeTopupDto,
    AutoRechargeTopupDtoMode, AutoRechargeTriggerDto, AutoRechargeTriggerDtoType_,
    AutoRechargeTriggeredResponse, BulkCreateUsageRequest, BulkCreateUsageRequestEventsItem,
    BulkCreateUsageRequestEventsItemActionType, BulkCreateUsageRequestEventsItemOutcome,
    BulkUsageResponse, BulkUsageResultResponse, BulkUsageResultResponseCreditDebit,
    BusinessDetailsDto, CancelPurchaseRequest, CheckLimitRequest, CloneProductDto,
    ConfigureMcpPlansDto, ConfigureMcpPlansDtoPlansItem, ConfigureMcpPlansDtoPlansItemBillingCycle,
    ConfigureMcpPlansDtoPlansItemBillingModel, ConfigureMcpPlansDtoPlansItemPricingOptionsItem,
    ConfigureMcpPlansDtoPlansItemType_, ConfigureMcpPlansDtoToolMappingItem,
    ConfigureMcpPlansResult, CreateCheckoutSessionRequest, CreateCheckoutSessionRequestPurpose,
    CreateCheckoutSessionResponse, CreateCustomerRequest, CreateCustomerSessionRequest,
    CreateCustomerSessionResponse, CreatePaymentIntentDto, CreatePaymentIntentDtoAutoRecharge,
    CreatePaymentIntentDtoAutoRechargeTriggerType, CreatePaymentIntentDtoPurpose,
    CreatePlanRequest, CreatePlanRequestBillingCycle, CreatePlanRequestBillingModel,
    CreatePlanRequestBillingStrategy, CreatePlanRequestFulfillment, CreatePlanRequestOveragePolicy,
    CreatePlanRequestPricingOptionsItem, CreatePlanRequestProrationPolicy,
    CreatePlanRequestProrationPolicyMethod, CreatePlanRequestReturnPolicy, CreatePlanRequestStatus,
    CreatePlanRequestTaxBehavior, CreatePlanRequestType_, CreatePlanRequestUsageTracking,
    CreatePlanRequestUsageTrackingGranularity, CreatePlanRequestUsageTrackingMethod,
    CreatePlanRequestWarranty, CreateProductRequest, CreateProductRequestConfig,
    CreateProductRequestTaxBehavior, CreateUsageRequest, CreateUsageRequestActionType,
    CreateUsageRequestOutcome, CreditDebitSkippedResponse, CreditDebitSkippedResponseReason,
    CreditDebitSuccessResponse, CustomerBalanceDisplayDto, CustomerBalanceDisplayDtoRateSource,
    CustomerBalanceResponse, CustomerResponse, DeletePlansResponse, DeleteProductsResponse,
    DeleteProductsResponseAction, DisableAutoRechargeResponse, GetCustomerResponse,
    GetCustomerSessionResponse, GetCustomerSessionResponseStatus, GetPlansResponse,
    GetProductResponse, GetProductsResponse, GetPurchasesResponse, GrantCustomerCreditsRequest,
    GrantCustomerCreditsResponse, LimitBalanceDto, LimitPlanItemDto, LimitProductBriefDto,
    LimitResponse, McpBootstrapDto, McpBootstrapDtoPlansItem, McpBootstrapDtoPlansItemBillingCycle,
    McpBootstrapDtoPlansItemBillingModel, McpBootstrapDtoPlansItemPricingOptionsItem,
    McpBootstrapDtoPlansItemType_, McpBootstrapDtoToolsItem, McpBootstrapResult,
    McpBootstrapResultAutoMappedToolsItem, PaymentMethodCard, PaymentMethodCardKind,
    PaymentMethodNone, PaymentMethodNoneKind, PaymentMethodResult, Plan, PlanBillingModel,
    PlanPricingOptionDto, PlanTaxBehavior, PlanType_, PostBulkResponse, PostCancelResponse,
    PostMeterEventsResponse, PostReactivateResponse, ProcessPaymentCancelled,
    ProcessPaymentCancelledStatus, ProcessPaymentFailed, ProcessPaymentFailedStatus,
    ProcessPaymentIntentDto, ProcessPaymentProcessing, ProcessPaymentProcessingStatus,
    ProcessPaymentSucceededBare, ProcessPaymentSucceededBareStatus, ProcessPaymentSucceededOneTime,
    ProcessPaymentSucceededOneTimeStatus, ProcessPaymentSucceededOneTimeType_,
    ProcessPaymentSucceededRecurring, ProcessPaymentSucceededRecurringStatus,
    ProcessPaymentSucceededRecurringType_, ProcessPaymentTimeout, ProcessPaymentTimeoutStatus,
    ProductConfigDto, PurchaseInfo, PutAutoRechargeSdkDto, PutAutoRechargeSdkDtoTriggerType,
    RecordBulkMeterEventsZodDto, RecordBulkMeterEventsZodDtoEventsItem, RecordMeterEventZodDto,
    SaveAutoRechargeResponse, SdkMerchantResponseDto, SdkPaymentIntentListItem,
    SdkPaymentIntentListResponse, SdkPaymentIntentResponse, SdkPlanResponse, SdkPlanSnapshotDto,
    SdkPlatformConfigResponseDto, SdkProductResponse, SdkPurchaseResponse,
    SdkPurchaseResponseBillingCycle, UpdateCustomerRequest, UpdatePlanRequest,
    UpdatePlanRequestBillingCycle, UpdatePlanRequestBillingModel, UpdatePlanRequestBillingStrategy,
    UpdatePlanRequestFulfillment, UpdatePlanRequestOveragePolicy,
    UpdatePlanRequestPricingOptionsItem, UpdatePlanRequestProrationPolicy,
    UpdatePlanRequestProrationPolicyMethod, UpdatePlanRequestReturnPolicy, UpdatePlanRequestStatus,
    UpdatePlanRequestTaxBehavior, UpdatePlanRequestWarranty, UpdateProductRequest,
    UpdateProductRequestConfig, UpdateProductRequestTaxBehavior, UsageBillingDto,
    UsageRecordResponse, UsageRecordResponseCreditDebit, UserInfoPlanDto, UserInfoPurchaseDto,
    UserInfoRequest, UserInfoResponse, UserInfoUsageDto, UserInfoUserDto, WebhookEventCategoryDto,
    WebhookEventDataDto, WebhookEventDefinitionDto, WebhookEventDefinitionDtoStatus,
    WebhookEventDto, WebhookEventRequestDto, WebhookEventType,
};
