import { digestValue } from "@nicia-ai/lachesis";
import {
  designM4d1Power,
  identifyM4d1CandidatePolicy,
  M4D1_CORPUS_DISJOINTNESS_REQUIREMENTS,
  M4D1_EXISTING_M4A_DISPOSITION,
  M4D1_REDUCED_ORACLE_PROMPT,
} from "@nicia-ai/lachesis-evidence";
import {
  createM4d1ProtocolProbeDesign,
  M4D1_ORACLE_IDENTITIES,
  M4D1_OUTPUT_JSON_SCHEMA,
  M4D1_PROVIDER_ADAPTER_VERSION,
} from "@nicia-ai/lachesis-generator-ai-sdk";

async function main(): Promise<number> {
  const [candidatePolicy, powerDesign, prompt, outputSchema, disjointness] =
    await Promise.all([
      identifyM4d1CandidatePolicy(),
      designM4d1Power(),
      digestValue(M4D1_REDUCED_ORACLE_PROMPT),
      digestValue(M4D1_OUTPUT_JSON_SCHEMA),
      digestValue(M4D1_CORPUS_DISJOINTNESS_REQUIREMENTS),
    ]);
  const probe = createM4d1ProtocolProbeDesign();
  if (
    !candidatePolicy.ok ||
    !powerDesign.ok ||
    !prompt.ok ||
    !outputSchema.ok ||
    !disjointness.ok ||
    !probe.ok
  ) {
    process.stderr.write("M4d.1 offline design derivation failed.\n");
    return 1;
  }
  const probeDigest = await digestValue(probe.value);
  if (!probeDigest.ok) {
    process.stderr.write("M4d.1 protocol-probe design cannot be identified.\n");
    return 1;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        baselineCommit: "ad875ca89608e3b3d9f1fd44bc7e342af51748e3",
        existingM4aDisposition: M4D1_EXISTING_M4A_DISPOSITION,
        candidatePolicyDigest: candidatePolicy.value,
        powerDesign: powerDesign.value,
        reducedPromptDigest: prompt.value,
        outputSchemaDigest: outputSchema.value,
        disjointnessContractDigest: disjointness.value,
        adapterVersion: M4D1_PROVIDER_ADAPTER_VERSION,
        providerIdentities: M4D1_ORACLE_IDENTITIES,
        protocolProbe: probe.value,
        protocolProbeDigest: probeDigest.value,
        liveInferenceAuthorized: false,
        materializationAuthorized: false,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

process.exitCode = await main();
