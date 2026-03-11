import { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger as any, {
    openapi: {
      info: {
        title: "Stratum Control Plane API",
        version: "0.1.0",
        description: "Universal Tenant Context Engine - Control Plane",
      },
      components: {
        securitySchemes: {
          apiKey: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
          },
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [{ apiKey: [] }, { bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi as any, {
    routePrefix: "/api/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
    staticCSP: true,
  });
}
