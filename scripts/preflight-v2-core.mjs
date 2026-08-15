const OFFICIAL_USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

const normalize = (value) => String(value).toLowerCase();
const same = (left, right) => normalize(left) === normalize(right);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function sameSet(left, right) {
  return [...left].map(normalize).sort().join("|") === [...right].map(normalize).sort().join("|");
}

export function assertChainAndReceipts(manifest, snapshot) {
  requireCondition(BigInt(snapshot.chainId) === 84_532n, "Wrong Base Sepolia chain id");
  requireCondition(
    snapshot.deploymentReceipt?.status === 1 &&
    snapshot.deploymentReceipt.blockNumber === manifest.diamond.deploymentBlock &&
    same(snapshot.deploymentReceipt.contractAddress, manifest.diamond.address),
    "Fresh Diamond creation receipt proof mismatch",
  );
  requireCondition(snapshot.deploymentCreatedAt === manifest.createdAt, "Deployment timestamp mismatch");
  requireCondition(
    snapshot.initializationReceipt?.status === 1 &&
    snapshot.initializationReceipt.blockNumber === manifest.initialization.block,
    "v2 initialization receipt proof mismatch",
  );
  requireCondition(
    same(snapshot.initializationTransaction?.to, manifest.diamond.address) &&
    same(snapshot.initializationTransaction?.from, manifest.diamond.owner) &&
    BigInt(snapshot.initializationTransaction?.value ?? -1) === 0n,
    "Initialization transaction authority/value mismatch",
  );
}

export function assertCodeAndToken(manifest, snapshot) {
  requireCondition(same(snapshot.diamondCodeHash, manifest.diamond.codeHash), "Diamond code hash mismatch");
  requireCondition(same(snapshot.usdcAddress, OFFICIAL_USDC), "Official Base Sepolia USDC mismatch");
  requireCondition(same(snapshot.usdcCodeHash, manifest.usdc.codeHash), "USDC code hash mismatch");
  requireCondition(snapshot.usdcDecimals === 6n, "USDC decimals mismatch");
  requireCondition(
    same(snapshot.initializerCodeHash, manifest.initialization.initializerCodeHash),
    "Initializer code hash mismatch",
  );
}

export function assertProtocolIdentity(manifest, snapshot) {
  requireCondition(snapshot.initialized === true, "Diamond is not initialized");
  requireCondition(same(snapshot.protocolId, manifest.protocolId), "Protocol id mismatch");
  requireCondition(BigInt(snapshot.protocolVersion) === BigInt(manifest.protocolVersion), "Protocol version mismatch");
  requireCondition(BigInt(snapshot.layoutVersion) === BigInt(manifest.layoutVersion), "Layout version mismatch");
  requireCondition(same(snapshot.storageNamespace, manifest.storageNamespace), "Storage namespace mismatch");
  requireCondition(same(snapshot.usdcToken, manifest.usdc.address), "Configured USDC mismatch");
  requireCondition(snapshot.paused === true, "Fresh v2 Diamond is not paused");
  requireCondition(same(snapshot.owner, manifest.diamond.owner), "Diamond owner mismatch");
}

export function assertAuthorities(manifest, snapshot) {
  for (const [name, role] of Object.entries(manifest.roles)) {
    const actual = snapshot.roles[name];
    requireCondition(actual !== undefined, `${name} snapshot missing`);
    requireCondition(same(actual.id, role.id), `${name} id mismatch`);
    requireCondition(actual.memberCount === 1n, `${name} member count mismatch`);
    requireCondition(actual.expectedAuthorized === true, `${name} expected address missing`);
  }
  requireCondition(snapshot.ownerRoleCount === 0, "Diamond owner holds an application role");
  for (const roleCount of snapshot.expectedAddressRoleCounts) {
    requireCondition(roleCount === 1, "Application role accounts are not mutually exclusive");
  }
}

export function assertLoupe(manifest, snapshot) {
  requireCondition(
    sameSet(snapshot.facetAddresses, manifest.facets.map(({ address }) => address)),
    "Diamond facet-address set mismatch",
  );
  for (const facet of manifest.facets) {
    const actual = snapshot.facets[facet.name];
    requireCondition(actual !== undefined, `${facet.name} snapshot missing`);
    requireCondition(same(actual.address, facet.address), `${facet.name} address mismatch`);
    requireCondition(same(actual.codeHash, facet.codeHash), `${facet.name} code hash mismatch`);
    requireCondition(sameSet(actual.selectors, facet.functionSelectors), `${facet.name} selectors mismatch`);
    requireCondition(actual.selectorOwnersMatch === true, `${facet.name} selector ownership mismatch`);
  }
}

export function assertInitializationEvidence(manifest, snapshot) {
  requireCondition(same(snapshot.initializerAddress, manifest.initialization.initializerAddress), "Initializer target mismatch");
  requireCondition(same(snapshot.calldataHash, manifest.initialization.calldataHash), "Initializer calldata mismatch");
  requireCondition(snapshot.cutMatches === true, "Fresh initialization cut mismatch");
  requireCondition(snapshot.protocolInitializedMatches === true, "ProtocolInitialized evidence mismatch");
  requireCondition(snapshot.roleEventsMatch === true, "Bootstrap RoleGranted evidence mismatch");
  requireCondition(snapshot.configEventsMatch === true, "Bootstrap config/pause evidence mismatch");
}
