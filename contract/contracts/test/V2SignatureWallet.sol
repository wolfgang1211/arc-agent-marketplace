// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IWalletTarget {
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4);
}

contract V2SignatureWallet {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    address public owner;
    uint8 public mode; // 0 valid, 1 wrong magic, 2 revert, 3 short return
    address public callbackTarget;
    bytes public callbackData;

    constructor(address initialOwner) { owner = initialOwner; }

    modifier onlyOwner() { require(msg.sender == owner, "owner"); _; }

    function setMode(uint8 value) external onlyOwner { mode = value; }
    function setCallback(address target, bytes calldata data) external onlyOwner {
        callbackTarget = target; callbackData = data;
    }
    function execute(address target, uint256 value, bytes calldata data) external onlyOwner returns (bytes memory) {
        (bool ok, bytes memory out) = target.call{value: value}(data);
        require(ok, "execute failed"); return out;
    }
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        digest; signature;
        if (callbackTarget != address(0)) {
            // This is deliberately a state-changing/reentrant callback under staticcall.
            (bool ignored,) = callbackTarget.staticcall(callbackData);
            ignored;
        }
        if (mode == 1) return 0xffffffff;
        if (mode == 2) revert("wallet rejected");
        if (mode == 3) assembly { mstore(0, 0x12) return(31, 1) }
        return MAGIC;
    }
    receive() external payable {}
}
