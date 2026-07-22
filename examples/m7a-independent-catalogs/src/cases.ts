import type { Catalog } from "@nicia-ai/lachesis";
import type { CatalogConformanceSuite } from "@nicia-ai/lachesis-generator";

import { createSupportCatalogA } from "./authors/support-a.js";
import { createSupportCatalogB } from "./authors/support-b.js";
import { createTransitCatalogA } from "./authors/transit-a.js";
import { createTransitCatalogB } from "./authors/transit-b.js";
import { createWarehouseCatalogA } from "./authors/warehouse-a.js";
import { createWarehouseCatalogB } from "./authors/warehouse-b.js";
import {
  createHostileCatalog,
  type HostileCaseId,
  hostileCaseIds,
} from "./hostile-catalogs.js";
import { supportSuite, transitSuite, warehouseSuite } from "./suites.js";

export type CatalogFamily = "warehouse" | "transit" | "support";

export type BlindedTrialCase = Readonly<{
  caseId: string;
  family: CatalogFamily;
  left: Catalog;
  right: Catalog;
  suite: CatalogConformanceSuite;
}>;

function hostileFamily(caseId: HostileCaseId): CatalogFamily {
  if (caseId === "blind-04" || caseId === "blind-05" || caseId === "blind-06")
    return "warehouse";
  if (caseId === "blind-07" || caseId === "blind-08" || caseId === "blind-09")
    return "transit";
  return "support";
}

function suiteFor(family: CatalogFamily): CatalogConformanceSuite {
  switch (family) {
    case "warehouse":
      return warehouseSuite;
    case "transit":
      return transitSuite;
    case "support":
      return supportSuite;
  }
}

function referenceCatalog(family: CatalogFamily): Catalog {
  switch (family) {
    case "warehouse":
      return createWarehouseCatalogA();
    case "transit":
      return createTransitCatalogA();
    case "support":
      return createSupportCatalogA();
  }
}

/** Returns cases without expected labels or mutation rationales. */
export function loadBlindedTrialCases(): ReadonlyArray<BlindedTrialCase> {
  const positives: ReadonlyArray<BlindedTrialCase> = [
    {
      caseId: "blind-01",
      family: "warehouse",
      left: createWarehouseCatalogA(),
      right: createWarehouseCatalogB(),
      suite: warehouseSuite,
    },
    {
      caseId: "blind-02",
      family: "transit",
      left: createTransitCatalogA(),
      right: createTransitCatalogB(),
      suite: transitSuite,
    },
    {
      caseId: "blind-03",
      family: "support",
      left: createSupportCatalogA(),
      right: createSupportCatalogB(),
      suite: supportSuite,
    },
  ];
  const hostile = hostileCaseIds.map((caseId): BlindedTrialCase => {
    const family = hostileFamily(caseId);
    return {
      caseId,
      family,
      left: referenceCatalog(family),
      right: createHostileCatalog(caseId),
      suite: suiteFor(family),
    };
  });
  return [...positives, ...hostile];
}
