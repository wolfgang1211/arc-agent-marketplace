// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Arc'ın USDC'sini taklit eder: blocklist'teki adrese/adresten
/// transfer revert eder. Arc dökümanı: "A value transfer to or from a
/// blocklisted address reverts."
contract BlocklistUSDC is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Blocklist USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address who, bool v) external {
        blocked[who] = v;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[from], "Blocklisted sender");
        require(!blocked[to], "Blocklisted recipient");
        super._update(from, to, value);
    }
}
