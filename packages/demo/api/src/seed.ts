import { Pool } from "pg";

const API_BASE =
  process.env.CONTROL_PLANE_URL || "http://localhost:3001/api/v1";
const API_KEY = process.env.API_KEY || "sk_live_demo_key";

async function api(path: string, body?: unknown, method?: string): Promise<Record<string, any>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${err}`);
  }
  return res.json() as Promise<Record<string, any>>;
}

async function seed() {
  console.log("Seeding Stratum demo data...\n");

  // 1. Create tenant hierarchy
  console.log("Creating tenant hierarchy...");
  const acmesec = await api("/tenants", {
    name: "AcmeSec",
    slug: "acmesec",
    isolation_strategy: "SHARED_RLS",
  });
  console.log(`  Created AcmeSec (${acmesec.id})`);

  const northstar = await api("/tenants", {
    name: "NorthStar MSP",
    slug: "northstar_msp",
    parent_id: acmesec.id,
    isolation_strategy: "SHARED_RLS",
  });
  console.log(`  Created NorthStar MSP (${northstar.id})`);

  const clientAlpha = await api("/tenants", {
    name: "Client Alpha",
    slug: "client_alpha",
    parent_id: northstar.id,
    isolation_strategy: "SHARED_RLS",
  });

  const clientBeta = await api("/tenants", {
    name: "Client Beta",
    slug: "client_beta",
    parent_id: northstar.id,
    isolation_strategy: "SHARED_RLS",
  });

  const southshield = await api("/tenants", {
    name: "SouthShield MSP",
    slug: "southshield_msp",
    parent_id: acmesec.id,
    isolation_strategy: "SHARED_RLS",
  });

  const clientGamma = await api("/tenants", {
    name: "Client Gamma",
    slug: "client_gamma",
    parent_id: southshield.id,
    isolation_strategy: "SHARED_RLS",
  });

  console.log("  Created full hierarchy\n");

  // 2. Set config values with inheritance
  console.log("Setting config values...");
  await api(`/tenants/${acmesec.id}/config/max_users`, {
    value: 1000,
    locked: false,
  }, "PUT");
  await api(`/tenants/${acmesec.id}/config/features.siem`, {
    value: true,
    locked: true,
  }, "PUT");
  await api(`/tenants/${acmesec.id}/config/features.edr`, {
    value: false,
    locked: false,
  }, "PUT");
  await api(`/tenants/${northstar.id}/config/max_users`, {
    value: 500,
    locked: false,
  }, "PUT");
  await api(`/tenants/${northstar.id}/config/features.edr`, {
    value: true,
    locked: false,
  }, "PUT");
  await api(`/tenants/${clientAlpha.id}/config/max_users`, {
    value: 50,
    locked: false,
  }, "PUT");
  console.log("  Config values set\n");

  // 3. Set permissions
  console.log("Setting permissions...");
  await api(`/tenants/${acmesec.id}/permissions`, {
    key: "manage_users",
    value: true,
    mode: "LOCKED",
    revocation_mode: "CASCADE",
  });
  await api(`/tenants/${northstar.id}/permissions`, {
    key: "custom_reports",
    value: true,
    mode: "DELEGATED",
    revocation_mode: "SOFT",
  });
  await api(`/tenants/${acmesec.id}/permissions`, {
    key: "api_access",
    value: true,
    mode: "INHERITED",
    revocation_mode: "CASCADE",
  });
  console.log("  Permissions set\n");

  // 4. Create security_events table with RLS
  console.log("Creating security_events table with RLS...");
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://stratum:stratum@localhost:5432/stratum",
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_events (
      id SERIAL PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      source_ip TEXT,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`ALTER TABLE security_events ENABLE ROW LEVEL SECURITY`);
  await pool.query(`ALTER TABLE security_events FORCE ROW LEVEL SECURITY`);
  await pool.query(`
    DO $$ BEGIN
      CREATE POLICY tenant_isolation ON security_events
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  // 5. Insert sample events
  console.log("Inserting sample security events...");
  const events = [
    {
      tenant: acmesec.id,
      type: "login_attempt",
      severity: "low",
      ip: "10.0.0.1",
      desc: "Admin login from HQ",
    },
    {
      tenant: acmesec.id,
      type: "policy_change",
      severity: "medium",
      ip: "10.0.0.1",
      desc: "Updated firewall rules",
    },
    {
      tenant: northstar.id,
      type: "malware_detected",
      severity: "high",
      ip: "192.168.1.50",
      desc: "Trojan detected on endpoint",
    },
    {
      tenant: northstar.id,
      type: "port_scan",
      severity: "medium",
      ip: "192.168.1.100",
      desc: "Internal port scan detected",
    },
    {
      tenant: clientAlpha.id,
      type: "ransomware_attempt",
      severity: "critical",
      ip: "172.16.0.5",
      desc: "Ransomware encryption attempt blocked",
    },
    {
      tenant: clientAlpha.id,
      type: "data_exfil",
      severity: "high",
      ip: "172.16.0.10",
      desc: "Unusual outbound data transfer",
    },
    {
      tenant: clientBeta.id,
      type: "brute_force",
      severity: "high",
      ip: "10.10.0.20",
      desc: "SSH brute force attempt",
    },
    {
      tenant: clientBeta.id,
      type: "login_attempt",
      severity: "low",
      ip: "10.10.0.1",
      desc: "Normal user login",
    },
    {
      tenant: southshield.id,
      type: "ddos_attempt",
      severity: "critical",
      ip: "203.0.113.50",
      desc: "DDoS attack mitigated",
    },
    {
      tenant: southshield.id,
      type: "cert_expiry",
      severity: "medium",
      ip: null,
      desc: "SSL certificate expiring in 7 days",
    },
    {
      tenant: clientGamma.id,
      type: "phishing",
      severity: "high",
      ip: "198.51.100.5",
      desc: "Phishing email quarantined",
    },
    {
      tenant: clientGamma.id,
      type: "login_attempt",
      severity: "low",
      ip: "10.20.0.1",
      desc: "Normal user login",
    },
  ];

  for (const e of events) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [e.tenant]);
      await client.query(
        `INSERT INTO security_events (tenant_id, event_type, severity, source_ip, description) VALUES ($1, $2, $3, $4, $5)`,
        [e.tenant, e.type, e.severity, e.ip, e.desc]
      );
      await client.query("COMMIT");
    } finally {
      await client.query("RESET app.current_tenant_id");
      client.release();
    }
  }
  console.log(`  Inserted ${events.length} events\n`);

  await pool.end();
  console.log("Seed complete!");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
