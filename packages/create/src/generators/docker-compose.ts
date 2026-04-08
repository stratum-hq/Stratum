import type { StackPreset } from "../matrix.js";

export function generatePresetDockerCompose(projectName: string, preset: StackPreset): string {
  const dbName = projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();

  switch (preset.database) {
    case "postgres":
      return generatePostgresCompose(projectName, dbName);
    case "mongodb":
      return generateMongoCompose(projectName, dbName);
    case "mysql":
      return generateMysqlCompose(projectName, dbName);
  }
}

function generatePostgresCompose(projectName: string, dbName: string): string {
  return `# Docker Compose for ${projectName}
# Start with: docker compose up -d
version: "3.8"

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${dbName}
      POSTGRES_USER: ${dbName}
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${dbName}"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
`;
}

function generateMongoCompose(projectName: string, dbName: string): string {
  return `# Docker Compose for ${projectName}
# Start with: docker compose up -d
version: "3.8"

services:
  db:
    image: mongo:7
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${dbName}
      MONGO_INITDB_ROOT_PASSWORD: dev_password
      MONGO_INITDB_DATABASE: ${dbName}
    ports:
      - "27017:27017"
    volumes:
      - db_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
`;
}

function generateMysqlCompose(projectName: string, dbName: string): string {
  return `# Docker Compose for ${projectName}
# Start with: docker compose up -d
version: "3.8"

services:
  db:
    image: mysql:8
    environment:
      MYSQL_DATABASE: ${dbName}
      MYSQL_USER: ${dbName}
      MYSQL_PASSWORD: dev_password
      MYSQL_ROOT_PASSWORD: dev_root_password
    ports:
      - "3306:3306"
    volumes:
      - db_data:/var/lib/mysql
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
`;
}
