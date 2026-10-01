// Browser replacement for `node:net`. The webhook service builds its list of
// blocked address ranges when the module loads, so BlockList must construct
// and accept ranges. Webhook delivery cannot run in a browser, so a lookup
// fails instead of answering.
function unavailable(name: string): never {
  throw new Error(`net.${name} is not available in the browser Playground`);
}

class BlockList {
  addSubnet(): void {}
  addAddress(): void {}
  addRange(): void {}
  check(): boolean {
    return unavailable("BlockList.check");
  }
}

const isIP = (): number => unavailable("isIP");
const isIPv4 = (): boolean => unavailable("isIPv4");
const isIPv6 = (): boolean => unavailable("isIPv6");

export default { BlockList, isIP, isIPv4, isIPv6 };
export { BlockList, isIP, isIPv4, isIPv6 };
