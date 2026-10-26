export interface Env {
  LOBBY: DurableObjectNamespace;
  LEDGER: R2Bucket;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  DEV_ADMIN: string;
}
