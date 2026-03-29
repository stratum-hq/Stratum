export interface BlogPost {
  title: string;
  description: string;
  link: string;
  pubDate: Date;
}

export const blogPosts: BlogPost[] = [
  {
    title: 'The State of Multi-Tenancy in Node.js: 204 Packages, Zero Standards',
    description:
      'We surveyed 204 npm packages, 6 GitHub repositories, and dozens of community threads. Here is what the Node.js multi-tenancy ecosystem actually looks like.',
    link: '/blog/the-state-of-multi-tenancy-in-nodejs/',
    pubDate: new Date('2026-03-29'),
  },
  {
    title: 'Why We Built Stratum',
    description:
      'Every B2B SaaS team reinvents multi-tenancy from scratch. We built Stratum so they never have to again.',
    link: '/blog/why-we-built-stratum/',
    pubDate: new Date('2026-03-27'),
  },
  {
    title: "What's Next for Stratum",
    description:
      'Post-v0.2.3 roadmap: security hardening, community growth, and the road to 1.0.',
    link: '/blog/whats-next-for-stratum/',
    pubDate: new Date('2026-03-27'),
  },
];
