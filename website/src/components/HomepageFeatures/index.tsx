import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
  emoji: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Hierarchical Multi-Tenancy',
    emoji: '\uD83C\uDFD7\uFE0F',
    description: (
      <>
        Model tenants as a tree with unlimited nesting. MSSP &rarr; MSP &rarr; Client
        hierarchies with PostgreSQL ltree for efficient subtree queries. Advisory locks
        prevent race conditions on concurrent modifications.
      </>
    ),
  },
  {
    title: 'Config Inheritance & Permissions',
    emoji: '\uD83D\uDD12',
    description: (
      <>
        Config values flow root-to-leaf with lock semantics. Permissions support
        LOCKED, INHERITED, and DELEGATED modes with CASCADE, SOFT, and PERMANENT
        revocation. Full source attribution on every resolved value.
      </>
    ),
  },
  {
    title: 'Row-Level Security',
    emoji: '\uD83D\uDEE1\uFE0F',
    description: (
      <>
        PostgreSQL RLS policies enforce tenant isolation at the database level.
        FORCE ROW LEVEL SECURITY on all tables. Parameterized context setting.
        Zero chance of cross-tenant data leakage.
      </>
    ),
  },
  {
    title: 'Two Integration Paths',
    emoji: '\uD83D\uDD00',
    description: (
      <>
        Use <code>@stratum/lib</code> for direct in-process calls (maximum performance),
        or run the control plane as a service with <code>@stratum/sdk</code> for
        polyglot stacks. Same API, your choice of transport.
      </>
    ),
  },
  {
    title: 'Express & Fastify Middleware',
    emoji: '\u26A1',
    description: (
      <>
        Drop-in middleware resolves tenant from JWT, headers, or custom resolvers.
        AsyncLocalStorage propagates context through your entire call stack.
        Built-in LRU cache minimizes HTTP overhead.
      </>
    ),
  },
  {
    title: 'React Admin Components',
    emoji: '\u2699\uFE0F',
    description: (
      <>
        Pre-built TenantSwitcher, TenantTree, ConfigEditor, and PermissionEditor
        components. Wrap your app in <code>StratumProvider</code> and get a full
        admin interface with minimal code.
      </>
    ),
  },
];

function Feature({title, emoji, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center" style={{fontSize: '3rem', marginBottom: '0.5rem'}}>
        {emoji}
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
