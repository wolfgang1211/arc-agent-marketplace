"use client";

import { useEffect, useState } from "react";
import { useConfig } from "wagmi";
import { getBlock, readContract } from "wagmi/actions";
import { arcTestnet, EXPLORER } from "../../lib/chain";
import { CONTRACT_ADDRESS, MARKETPLACE_ABI } from "../../lib/contract";
import { loadRecentActivity } from "../../lib/job-lifecycle.mjs";
import { RecentActivityView } from "./job-lifecycle";

export function RecentActivity() {
  const config = useConfig();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ snapshot: null, loading: true, error: "" });
  useEffect(() => {
    let active = true;
    setState({ snapshot: null, loading: true, error: "" });
    if (!CONTRACT_ADDRESS) {
      setState({ snapshot: null, loading: false, error: "Marketplace address is not configured." });
      return undefined;
    }
    loadRecentActivity({
      getBlock: () => getBlock(config, { chainId: arcTestnet.id, blockTag: "latest" }),
      readContract: (functionName, args, blockNumber) => readContract(config, {
        address: CONTRACT_ADDRESS, abi: MARKETPLACE_ABI, chainId: arcTestnet.id,
        functionName, args, blockNumber,
      }),
    }).then((snapshot) => {
      if (active) setState({ snapshot, loading: false, error: "" });
    }).catch(() => {
      if (active) setState({ snapshot: null, loading: false, error: "The chain read failed. Retry with Refresh activity." });
    });
    return () => { active = false; };
  }, [config, revision]);
  return <RecentActivityView {...state} explorer={EXPLORER} marketplace={CONTRACT_ADDRESS} onRefresh={() => setRevision((value) => value + 1)} />;
}
