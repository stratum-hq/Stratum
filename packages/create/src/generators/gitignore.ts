/**
 * Return the .gitignore content of a generated project.
 *
 * @param prismaClient - True when `prisma generate` writes a client to src/generated/prisma.
 */
export function generateGitignore(prismaClient: boolean): string {
  return `# Dependencies
node_modules/

# Settings and secrets. Copy .env.example to .env and keep .env.example in git.
.env
.env.*
!.env.example

# Build output
dist/
.next/
out/
*.tsbuildinfo
${prismaClient ? "\n# The Prisma client. npx prisma generate writes it again from prisma/schema.prisma.\nsrc/generated/prisma/\n" : ""}
# Logs
*.log
npm-debug.log*

# macOS
.DS_Store
`;
}
