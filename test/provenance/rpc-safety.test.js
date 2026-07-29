"use strict";

const { expect } = require("chai");

const {
  READ_ONLY_RPC_METHODS,
  RpcClient,
} = require("../../scripts/provenance/rpc");

describe("Provenance — fail-closed RPC boundary", function () {
  it("exposes only the five read methods used by the forensic CLIs", function () {
    expect([...READ_ONLY_RPC_METHODS].sort()).to.deep.equal([
      "eth_blockNumber",
      "eth_call",
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_getCode",
    ]);
  });

  it("rejects signing and broadcast methods before making a network request", async function () {
    const rpc = new RpcClient("https://example.invalid");

    for (const method of [
      "eth_accounts",
      "eth_sendRawTransaction",
      "eth_sendTransaction",
      "personal_sign",
    ]) {
      let failure;
      try {
        await rpc.request(method);
      } catch (error) {
        failure = error;
      }

      expect(failure).to.be.an("error");
      expect(failure.code).to.equal("RPC_METHOD_FORBIDDEN");
      expect(failure.message).to.include(
        "is not allowed by read-only provenance tooling"
      );
    }
  });
});
