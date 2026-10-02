declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    INVENTORY_SETUP_KEY?: string;
  }
}
