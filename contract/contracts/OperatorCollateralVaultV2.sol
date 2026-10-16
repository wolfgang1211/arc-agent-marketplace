// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Immutable, marketplace-authorized operator collateral for V2.
/// @dev The marketplace address is fixed at construction; there is no admin path.
contract OperatorCollateralVaultV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_STAKE = 5_000_000;
    uint256 public constant STAKE_BPS = 1_000;

    IERC20 public immutable token;
    address public immutable marketplace;
    address public immutable treasury;

    mapping(address => uint256) public freeStake;
    mapping(address => uint256) public reservedStake;
    uint256 public stakeLiability;

    enum ReserveStatus { None, Reserved, FaultReview, Released, Slashed }
    struct Reservation {
        address operator;
        address client;
        uint256 amount;
        uint64 faultDeadline;
        bool faultPending;
        ReserveStatus disposition;
    }
    mapping(uint256 => Reservation) private _reserves;

    error ZeroAddress();
    error Unauthorized();
    error InvalidAmount();
    error DuplicateJob();
    error UnknownJob();
    error InsufficientFreeStake();
    error InvalidState();
    error FaultWindowClosed();
    error FaultWindowOpen();
    error Insolvent();
    error TransferMismatch();

    event StakeDeposited(address indexed operator, uint256 amount, uint256 freeAfter, uint256 liability);
    event StakeWithdrawn(address indexed operator, uint256 amount, uint256 freeAfter, uint256 liability);
    event StakeReserved(uint256 indexed jobId, address indexed operator, address indexed client, uint256 amount);
    event StakeReleased(uint256 indexed jobId, address indexed operator, uint256 amount);
    event FaultMarked(uint256 indexed jobId, address indexed operator, uint256 amount, uint64 faultDeadline);
    event StakeSlashed(uint256 indexed jobId, address indexed operator, uint256 reservedAmount, uint256 slash);
    event FaultReleased(uint256 indexed jobId, address indexed operator, uint256 amount);
    event SurplusSwept(address indexed treasury, uint256 amount);

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert Unauthorized();
        _;
    }

    constructor(address token_, address expectedMarketplace_, address treasury_) {
        if (token_ == address(0) || expectedMarketplace_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(this)) revert ZeroAddress();
        token = IERC20(token_);
        marketplace = expectedMarketplace_;
        treasury = treasury_;
    }

    function requiredStake(uint256 reward) public pure returns (uint256) {
        uint256 tenPercent = reward / 10 + (reward % 10 == 0 ? 0 : 1);
        uint256 floorApplied = tenPercent < MINIMUM_STAKE ? MINIMUM_STAKE : tenPercent;
        return (floorApplied + 9_999) / 10_000 * 10_000;
    }

    function reserveOf(uint256 jobId)
        external
        view
        returns (address operator, address client, uint256 amount, uint64 faultDeadline, bool faultPending, ReserveStatus disposition)
    {
        Reservation storage r = _reserves[jobId];
        return (r.operator, r.client, r.amount, r.faultDeadline, r.faultPending, r.disposition);
    }

    function depositStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert TransferMismatch();
        freeStake[msg.sender] += amount;
        stakeLiability += amount;
        emit StakeDeposited(msg.sender, amount, freeStake[msg.sender], stakeLiability);
    }

    function withdrawStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (freeStake[msg.sender] < amount) revert InsufficientFreeStake();
        freeStake[msg.sender] -= amount;
        stakeLiability -= amount;
        uint256 beforeBalance = token.balanceOf(msg.sender);
        token.safeTransfer(msg.sender, amount);
        if (token.balanceOf(msg.sender) - beforeBalance != amount) revert TransferMismatch();
        emit StakeWithdrawn(msg.sender, amount, freeStake[msg.sender], stakeLiability);
    }

    function reserve(uint256 jobId, address operator, address client, uint256 amount)
        external
        onlyMarketplace
        nonReentrant
    {
        if (jobId == 0 || operator == address(0) || client == address(0) || amount == 0) revert InvalidAmount();
        Reservation storage r = _reserves[jobId];
        if (r.disposition != ReserveStatus.None) revert DuplicateJob();
        if (freeStake[operator] < amount) revert InsufficientFreeStake();
        freeStake[operator] -= amount;
        reservedStake[operator] += amount;
        r.operator = operator;
        r.client = client;
        r.amount = amount;
        r.disposition = ReserveStatus.Reserved;
        emit StakeReserved(jobId, operator, client, amount);
    }

    function release(uint256 jobId) external onlyMarketplace nonReentrant {
        Reservation storage r = _reserves[jobId];
        if (r.disposition != ReserveStatus.Reserved || r.faultPending) revert InvalidState();
        uint256 amount = r.amount;
        address operator = r.operator;
        _release(r, ReserveStatus.Released);
        emit StakeReleased(jobId, operator, amount);
    }

    function markFault(uint256 jobId, uint64 faultDeadline) external onlyMarketplace nonReentrant {
        Reservation storage r = _reserves[jobId];
        if (r.disposition != ReserveStatus.Reserved || r.faultPending) revert InvalidState();
        r.faultDeadline = faultDeadline;
        r.faultPending = true;
        r.disposition = ReserveStatus.FaultReview;
        emit FaultMarked(jobId, r.operator, r.amount, faultDeadline);
    }

    function slashAndRelease(uint256 jobId, uint256 slash) external onlyMarketplace nonReentrant {
        Reservation storage r = _reserves[jobId];
        if (r.disposition != ReserveStatus.FaultReview || !r.faultPending) revert InvalidState();
        if (block.timestamp >= r.faultDeadline) revert FaultWindowClosed();
        if (slash > r.amount) revert InvalidAmount();

        address operator = r.operator;
        uint256 amount = r.amount;
        reservedStake[operator] -= amount;
        freeStake[operator] += amount - slash;
        stakeLiability -= slash;
        r.amount = 0;
        r.faultPending = false;
        r.disposition = ReserveStatus.Slashed;

        if (slash != 0) {
            uint256 beforeBalance = token.balanceOf(marketplace);
            token.safeTransfer(marketplace, slash);
            if (token.balanceOf(marketplace) - beforeBalance != slash) revert TransferMismatch();
        }
        emit StakeSlashed(jobId, operator, amount, slash);
    }

    function releaseFault(uint256 jobId) external onlyMarketplace nonReentrant {
        Reservation storage r = _reserves[jobId];
        if (r.disposition != ReserveStatus.FaultReview || !r.faultPending) revert InvalidState();
        if (block.timestamp < r.faultDeadline) revert FaultWindowOpen();
        uint256 amount = r.amount;
        address operator = r.operator;
        _release(r, ReserveStatus.Released);
        emit FaultReleased(jobId, operator, amount);
    }

    function sweepSurplus() external nonReentrant {
        uint256 balance = token.balanceOf(address(this));
        if (balance < stakeLiability) revert Insolvent();
        uint256 available = balance - stakeLiability;
        if (available == 0) revert InvalidAmount();
        uint256 beforeBalance = token.balanceOf(treasury);
        token.safeTransfer(treasury, available);
        if (token.balanceOf(treasury) - beforeBalance != available) revert TransferMismatch();
        emit SurplusSwept(treasury, available);
    }

    function _release(Reservation storage r, ReserveStatus terminal) private {
        reservedStake[r.operator] -= r.amount;
        freeStake[r.operator] += r.amount;
        r.amount = 0;
        r.faultPending = false;
        r.disposition = terminal;
    }
}
