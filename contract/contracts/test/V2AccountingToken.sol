// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Test-only ERC20 with blocklist, false-return, and swallowed callback hooks.
contract V2AccountingToken is IERC20 {
    string public constant name = "V2 Accounting USDC";
    string public constant symbol = "v2USDC";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    mapping(address => bool) public blocked;
    bool public returnFalse;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackAttempted;
    bool public callbackSucceeded;

    function totalSupply() external view override returns (uint256) { return _supply; }
    uint256 private _supply;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; _supply += amount; emit Transfer(address(0), to, amount); }
    function setBlocked(address who, bool value) external { blocked[who] = value; }
    function setReturnFalse(bool value) external { returnFalse = value; }
    function setCallback(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }

    function approve(address spender, uint256 amount) external override returns (bool) { allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true; }
    function transfer(address to, uint256 amount) external override returns (bool) { return _move(msg.sender, to, amount); }
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 a = allowance[from][msg.sender]; if (a < amount) revert("allowance"); allowance[from][msg.sender] = a - amount; emit Approval(from, msg.sender, a - amount); return _move(from, to, amount);
    }
    function _move(address from, address to, uint256 amount) internal returns (bool) {
        require(!blocked[from] && !blocked[to], "blocked");
        if (returnFalse) return false;
        require(balanceOf[from] >= amount, "balance");
        if (callbackTarget != address(0)) {
            callbackAttempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }
        balanceOf[from] -= amount; balanceOf[to] += amount; emit Transfer(from, to, amount); return true;
    }
}
