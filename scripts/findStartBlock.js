const { ethers } = require("hardhat");

async function main() {
  const addr = process.env.DIAMOND_ADDRESS;
  const provider = ethers.provider;
  const latest = await provider.getBlockNumber();
  const codeNow = await provider.getCode(addr);
  console.log("addr:", addr, "hasCode:", codeNow.length > 2, "head:", latest);

  let lo = 8000000, hi = latest;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const c = await provider.getCode(addr, mid);
    if (c === "0x") lo = mid + 1;
    else hi = mid;
  }
  console.log("creation block:", lo);
}

main().catch((e) => { console.error(e); process.exit(1); });
