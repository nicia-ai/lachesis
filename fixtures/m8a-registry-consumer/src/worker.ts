import { createPlanLanguageManifest } from "@nicia-ai/lachesis";

import { createIncidentCatalog } from "./catalog.js";

export default {
  async fetch(): Promise<Response> {
    const catalog = createIncidentCatalog("baseline");
    const manifest = await createPlanLanguageManifest(catalog.catalog, {
      allowedCapabilities: [catalog.decisionCapability],
      budget: {
        maxEffectCalls: 1,
        maxCollectionItems: 8,
        maxRecursionDepth: 0,
        maxTokens: 64,
        maxWallClockMs: 250,
        maxParallelism: 1,
      },
    });
    return manifest.ok
      ? Response.json({
          catalogFingerprint: manifest.value.catalogFingerprint,
          manifestDigest: manifest.value.manifestDigest,
          operationCount: catalog.operationCount,
        })
      : Response.json(
          { code: manifest.error.code, message: manifest.error.message },
          { status: 500 },
        );
  },
};
