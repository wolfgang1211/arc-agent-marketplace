// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OperatorCollateralVaultV2} from "../OperatorCollateralVaultV2.sol";

/// @notice Test-only stand-in for the future immutable marketplace.
contract V2VaultAuthority {
    OperatorCollateralVaultV2 public immutable vault;

    constructor(address vault_) {
        vault = OperatorCollateralVaultV2(vault_);
    }

    function reserve(uint256 jobId, address operator, address client, uint256 amount) external {
        vault.reserve(jobId, operator, client, amount);
    }

    function release(uint256 jobId) external { vault.release(jobId); }
    function markFault(uint256 jobId, uint64 deadline) external { vault.markFault(jobId, deadline); }
    function slashAndRelease(uint256 jobId, uint256 amount) external { vault.slashAndRelease(jobId, amount); }
    function releaseFault(uint256 jobId) external { vault.releaseFault(jobId); }
}
