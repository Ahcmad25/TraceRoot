export interface ApplicationData {
  configuration: Record<string, string>;
  accounts: Array<{ id: string; externalId: string; displayName: string }>;
  auditSinkAvailable: boolean;
}

export function createApplicationData(): ApplicationData {
  return {
    configuration: {
      PAYMENTS_API_KEY: "sandbox-payment-key",
    },
    accounts: [
      { id: "account-7", externalId: "ext-42", displayName: "Example Account" },
    ],
    auditSinkAvailable: false,
  };
}
