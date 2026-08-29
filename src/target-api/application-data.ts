export interface ApplicationData {
  configuration: Record<string, string>;
  accounts: Array<{ id: string; externalId: string; displayName: string }>;
  signingKeys: Array<{ id: string; material: string; active: boolean }>;
  auditSinkAvailable: boolean;
  profileVersion: number;
}

export function selectSigningKey(_keyId: string, data: Readonly<ApplicationData>) {
  return data.signingKeys[0];
}

export function createApplicationData(): ApplicationData {
  return {
    configuration: {
      PAYMENTS_API_KEY: "sandbox-payment-key",
      PAYMENT_RETRY_ENDPOINT: "https://sandbox.example.test/payment-retry",
      LEGACY_PAYMENT_RETRY_ENDPOINT: "",
    },
    accounts: [
      { id: "account-7", externalId: "ext-42", displayName: "Example Account" },
    ],
    signingKeys: [
      { id: "key-retired", material: "retired-signing-material", active: false },
      { id: "key-current", material: "current-signing-material", active: true },
    ],
    auditSinkAvailable: false,
    profileVersion: 7,
  };
}
