// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    Modifiers,
    Merchant,
    MerchantAccountStatus,
    MerchantAvailability,
    PaymentChannel,
    ChannelStatus,
    ChannelAvailability,
    Order,
    OrderType,
    OrderStatus,
    DisputeStatus,
    DisputeResult
} from "../shared/AppStorage.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { LibOrders } from "../libraries/LibOrders.sol";

/// @notice P2P order lifecycle: BUY / SELL creation, merchant assignment (up to 4 by
///         liquidity), acceptance, payment marking, completion, dispute window,
///         cancellation, and admin resolution. Off-chain INR is trusted on both sides.
contract OrderFacet is Modifiers {
    using SafeERC20 for IERC20;

    // ── Events (all order lifecycle → subgraph + backend notifications) ──────

    event OrderCreated(
        bytes32 indexed orderId,
        address indexed user,
        OrderType orderType,
        uint256 usdcAmount,
        uint256 fiatAmount,
        uint256 price,
        uint256 createdAt
    );
    event OrderAssigned(bytes32 indexed orderId, address indexed merchant, uint256 assignedAt);
    event OrderAccepted(
        bytes32 indexed orderId,
        address indexed merchant,
        bytes32 indexed channelId,
        uint256 acceptedAt
    );
    event OrderPaid(bytes32 indexed orderId, address indexed by, uint256 paidAt);
    event OrderCompleted(
        bytes32 indexed orderId,
        address indexed merchant,
        uint256 completedAt,
        uint256 disputeExpiresAt
    );
    event OrderCancelled(bytes32 indexed orderId, address indexed by, uint256 cancelledAt);
    event OrderRiskReleased(bytes32 indexed orderId, address indexed merchant, uint256 usdcAmount);
    event DisputeRaised(bytes32 indexed orderId, address indexed by, uint256 raisedAt);
    event DisputeResolved(
        bytes32 indexed orderId,
        address indexed resolver,
        DisputeResult result,
        uint256 resolvedAt
    );
    event MerchantDisputed(address indexed wallet);
    event MerchantDisputeCleared(address indexed wallet);

    // ── Creation ─────────────────────────────────────────────────────────────

    /// @notice USER creates a BUY order (wants to receive USDC, will pay INR off-chain).
    ///         Assigns up to 4 merchants whose unreserved USDC covers `usdcAmount`.
    ///         Returns the order id and the assigned merchant list.
    function createBuyOrder(uint256 usdcAmount)
        external
        notPaused
        nonReentrant
        returns (bytes32 orderId, address[] memory assigned)
    {
        require(usdcAmount > 0, "usdcAmount must be > 0");
        require(s.buyPriceInrPerUsdc > 0, "Buy price not set");

        uint256 price = s.buyPriceInrPerUsdc;
        uint256 fiat = LibOrders.computeFiatAmount(usdcAmount, price);

        orderId = _initOrder(OrderType.BUY, usdcAmount, fiat, price);
        assigned = _assignBuyMerchants(orderId, usdcAmount);
        require(assigned.length > 0, "No eligible merchants");
    }

    /// @notice USER creates a SELL order (giving USDC, will receive INR off-chain).
    ///         Pulls USDC into escrow (Diamond custody) immediately, then assigns up
    ///         to 4 merchants whose ACTIVE APPROVED channels have enough unreserved fiat.
    function createSellOrder(uint256 usdcAmount)
        external
        notPaused
        nonReentrant
        returns (bytes32 orderId, address[] memory assigned)
    {
        require(usdcAmount > 0, "usdcAmount must be > 0");
        require(s.sellPriceInrPerUsdc > 0, "Sell price not set");

        uint256 price = s.sellPriceInrPerUsdc;
        uint256 fiat = LibOrders.computeFiatAmount(usdcAmount, price);

        IERC20(s.config.usdcToken).safeTransferFrom(msg.sender, address(this), usdcAmount);

        orderId = _initOrder(OrderType.SELL, usdcAmount, fiat, price);
        assigned = _assignSellMerchants(orderId, fiat);
        if (assigned.length == 0) {
            // No merchant can serve — refund immediately, revert the whole tx so nothing sticks.
            revert("No eligible merchants");
        }
    }

    // ── Merchant acceptance ──────────────────────────────────────────────────

    /// @notice One of the assigned merchants claims the order and locks the required
    ///         side of liquidity (USDC for BUY, fiat for SELL) on the chosen channel.
    ///         First accept wins; subsequent accepts revert.
    function acceptOrder(bytes32 orderId, bytes32 channelId) external notPaused nonReentrant {
        Order storage o = _requireOrder(orderId);
        require(o.status == OrderStatus.CREATED, "Order not open");
        require(s.orderAssignmentIndex[orderId][msg.sender], "Not assigned");

        Merchant storage m = s.merchants[msg.sender];
        require(m.accountStatus == MerchantAccountStatus.ACTIVE, "Merchant not active");

        PaymentChannel storage ch = s.channels[channelId];
        require(ch.merchant == msg.sender, "Not your channel");
        require(ch.status == ChannelStatus.APPROVED, "Channel not APPROVED");
        require(ch.availability == ChannelAvailability.ACTIVE, "Channel not ACTIVE");

        if (o.orderType == OrderType.BUY) {
            require(LibOrders.unreservedUsdc(m) >= o.usdcAmount, "Insufficient USDC liquidity");
            m.reservedUsdc += o.usdcAmount;
        } else {
            require(LibOrders.unreservedFiat(ch) >= o.fiatAmount, "Insufficient fiat liquidity");
            ch.reservedFiat += o.fiatAmount;
        }

        o.status = OrderStatus.ACCEPTED;
        o.merchant = msg.sender;
        o.channelId = channelId;
        o.acceptedAt = block.timestamp;
        s.merchantOrderIds[msg.sender].push(orderId);

        emit OrderAccepted(orderId, msg.sender, channelId, block.timestamp);
    }

    // ── Payment marking & completion ─────────────────────────────────────────

    /// @notice The INR-paying party marks the off-chain payment as sent.
    ///         BUY: user is the payer → status ACCEPTED → PAID.
    ///         SELL: merchant is the payer → status ACCEPTED → PAID → COMPLETED
    ///               atomically (USDC credited to merchant into risk_usdc, dispute
    ///               window opened).
    function markPaymentSent(bytes32 orderId) external notPaused nonReentrant {
        Order storage o = _requireOrder(orderId);
        require(o.status == OrderStatus.ACCEPTED, "Not ACCEPTED");

        if (o.orderType == OrderType.BUY) {
            require(msg.sender == o.user, "Only user");
            o.status = OrderStatus.PAID;
            o.paidAt = block.timestamp;
            emit OrderPaid(orderId, msg.sender, block.timestamp);
        } else {
            require(msg.sender == o.merchant, "Only merchant");
            o.paidAt = block.timestamp;
            emit OrderPaid(orderId, msg.sender, block.timestamp);
            _completeSellOrder(o);
        }
    }

    /// @notice BUY only — merchant confirms INR receipt and releases escrowed USDC to user.
    ///         Requires the order to be in PAID status. No dispute window for BUY.
    function confirmPayment(bytes32 orderId) external notPaused nonReentrant {
        Order storage o = _requireOrder(orderId);
        require(o.orderType == OrderType.BUY, "SELL uses markPaymentSent");
        require(o.status == OrderStatus.PAID, "Not PAID");
        require(msg.sender == o.merchant, "Only merchant");

        Merchant storage m = s.merchants[o.merchant];
        PaymentChannel storage ch = s.channels[o.channelId];

        // Release reservation, debit merchant liquidity, credit fiat.
        m.reservedUsdc -= o.usdcAmount;
        m.usdcLiquidity -= o.usdcAmount;
        ch.fiatBalance += o.fiatAmount;

        o.status = OrderStatus.COMPLETED;
        o.completedAt = block.timestamp;

        IERC20(s.config.usdcToken).safeTransfer(o.user, o.usdcAmount);

        emit OrderCompleted(orderId, o.merchant, block.timestamp, 0);
    }

    // ── Cancellation ─────────────────────────────────────────────────────────

    /// @notice User can cancel while still CREATED (no merchant accepted).
    ///         For SELL, refunds the escrowed USDC back to the user.
    function cancelOrder(bytes32 orderId) external nonReentrant {
        Order storage o = _requireOrder(orderId);
        require(msg.sender == o.user, "Only user");
        require(o.status == OrderStatus.CREATED, "Only cancel CREATED");

        o.status = OrderStatus.CANCELLED;
        o.cancelledAt = block.timestamp;

        if (o.orderType == OrderType.SELL) {
            IERC20(s.config.usdcToken).safeTransfer(o.user, o.usdcAmount);
        }
        emit OrderCancelled(orderId, msg.sender, block.timestamp);
    }

    // ── Risk settlement (post dispute window) ────────────────────────────────

    /// @notice After the dispute window elapses on a COMPLETED SELL order, anyone
    ///         (keeper, merchant, dApp) can call this to release the merchant's
    ///         risk_usdc back into unreserved liquidity.
    function settleOrder(bytes32 orderId) external nonReentrant {
        Order storage o = _requireOrder(orderId);
        require(o.orderType == OrderType.SELL, "Only SELL settles");
        require(o.status == OrderStatus.COMPLETED, "Not COMPLETED");
        require(!o.riskReleased, "Already released");
        require(o.disputeStatus != DisputeStatus.OPEN, "Dispute open");
        require(block.timestamp >= o.disputeExpiresAt, "Window not elapsed");

        Merchant storage m = s.merchants[o.merchant];
        m.riskUsdc -= o.usdcAmount;
        o.riskReleased = true;

        if (o.disputeStatus == DisputeStatus.NONE) {
            o.disputeStatus = DisputeStatus.SETTLED;
        }
        emit OrderRiskReleased(orderId, o.merchant, o.usdcAmount);
    }

    // ── Disputes ─────────────────────────────────────────────────────────────

    /// @notice The user can raise a dispute during the window for a SELL order
    ///         that has COMPLETED (i.e. merchant claimed payment). Locks risk_usdc
    ///         indefinitely until admin resolves.
    function raiseDispute(bytes32 orderId) external notPaused {
        Order storage o = _requireOrder(orderId);
        require(msg.sender == o.user, "Only user");
        require(o.orderType == OrderType.SELL, "Only SELL disputable");
        require(o.status == OrderStatus.COMPLETED, "Not COMPLETED");
        require(o.disputeStatus == DisputeStatus.NONE, "Dispute already exists");
        require(!o.riskReleased, "Already settled");
        require(block.timestamp < o.disputeExpiresAt, "Window elapsed");

        o.disputeStatus = DisputeStatus.OPEN;
        Merchant storage m = s.merchants[o.merchant];
        if (m.accountStatus == MerchantAccountStatus.ACTIVE) {
            m.accountStatus = MerchantAccountStatus.DISPUTED;
            m.availability = MerchantAvailability.OFFLINE;
            emit MerchantDisputed(o.merchant);
        }
        emit DisputeRaised(orderId, msg.sender, block.timestamp);
    }

    /// @notice Admin resolves an OPEN dispute.
    ///         MERCHANT_WINS → risk_usdc released back to unreserved (merchant keeps USDC).
    ///         USER_WINS     → merchant is slashed by usdcAmount: risk_usdc released AND
    ///                         usdcLiquidity debited; USDC sent back to the user.
    function resolveDispute(bytes32 orderId, DisputeResult result) external onlyAdmin nonReentrant {
        require(result == DisputeResult.USER_WINS || result == DisputeResult.MERCHANT_WINS, "Bad result");
        Order storage o = _requireOrder(orderId);
        require(o.disputeStatus == DisputeStatus.OPEN, "Dispute not open");
        require(!o.riskReleased, "Already settled");

        Merchant storage m = s.merchants[o.merchant];
        m.riskUsdc -= o.usdcAmount;
        o.riskReleased = true;
        o.disputeStatus = DisputeStatus.SETTLED;
        o.disputeResolver = msg.sender;
        o.disputeResult = result;

        if (result == DisputeResult.USER_WINS) {
            m.usdcLiquidity -= o.usdcAmount;
            IERC20(s.config.usdcToken).safeTransfer(o.user, o.usdcAmount);
        }

        if (m.accountStatus == MerchantAccountStatus.DISPUTED) {
            m.accountStatus = MerchantAccountStatus.ACTIVE;
            emit MerchantDisputeCleared(o.merchant);
        }

        emit DisputeResolved(orderId, msg.sender, result, block.timestamp);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return s.orders[orderId];
    }

    function getOrderIds() external view returns (bytes32[] memory) {
        return s.orderIds;
    }

    function getUserOrders(address user) external view returns (bytes32[] memory) {
        return s.userOrderIds[user];
    }

    function getMerchantOrders(address merchant) external view returns (bytes32[] memory) {
        return s.merchantOrderIds[merchant];
    }

    function getAssignedMerchants(bytes32 orderId) external view returns (address[] memory) {
        return s.orders[orderId].assignedMerchants;
    }

    /// @notice merchant projections used by UI + off-chain guards.
    function getMerchantBalances(address merchant)
        external
        view
        returns (uint256 totalUsdc, uint256 reservedUsdc, uint256 riskUsdc, uint256 unreservedUsdc)
    {
        Merchant storage m = s.merchants[merchant];
        totalUsdc = m.usdcLiquidity;
        reservedUsdc = m.reservedUsdc;
        riskUsdc = m.riskUsdc;
        unreservedUsdc = m.usdcLiquidity - m.reservedUsdc - m.riskUsdc;
    }

    function getChannelFiat(bytes32 channelId)
        external
        view
        returns (uint256 totalFiat, uint256 reservedFiat, uint256 unreservedFiat)
    {
        PaymentChannel storage ch = s.channels[channelId];
        totalFiat = ch.fiatBalance;
        reservedFiat = ch.reservedFiat;
        unreservedFiat = ch.fiatBalance - ch.reservedFiat;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    function _requireOrder(bytes32 orderId) internal view returns (Order storage o) {
        o = s.orders[orderId];
        require(o.orderId != bytes32(0), "Order not found");
    }

    function _initOrder(
        OrderType orderType,
        uint256 usdcAmount,
        uint256 fiatAmount,
        uint256 price
    ) internal returns (bytes32 orderId) {
        unchecked {
            s.orderNonce += 1;
        }
        orderId = LibOrders.generateOrderId(msg.sender, s.orderNonce, block.chainid);

        Order storage o = s.orders[orderId];
        o.orderId = orderId;
        o.orderType = orderType;
        o.status = OrderStatus.CREATED;
        o.user = msg.sender;
        o.usdcAmount = usdcAmount;
        o.fiatAmount = fiatAmount;
        o.price = price;
        o.createdAt = block.timestamp;

        s.orderIds.push(orderId);
        s.userOrderIds[msg.sender].push(orderId);

        emit OrderCreated(orderId, msg.sender, orderType, usdcAmount, fiatAmount, price, block.timestamp);
    }

    function _assignBuyMerchants(bytes32 orderId, uint256 usdcAmount)
        internal
        returns (address[] memory assigned)
    {
        Order storage o = s.orders[orderId];
        uint256 count;
        address[] memory temp = new address[](LibOrders.MAX_ASSIGNMENTS);
        (address[] storage pool, uint256 poolLen) = _candidatePool();

        for (uint256 i = 0; i < poolLen && count < LibOrders.MAX_ASSIGNMENTS; i++) {
            address addr = pool[i];
            if (LibOrders.isBuyEligible(s.merchants[addr], usdcAmount)) {
                temp[count++] = addr;
                o.assignedMerchants.push(addr);
                s.orderAssignmentIndex[orderId][addr] = true;
                emit OrderAssigned(orderId, addr, block.timestamp);
            }
        }

        assigned = new address[](count);
        for (uint256 i = 0; i < count; i++) assigned[i] = temp[i];
    }

    function _assignSellMerchants(bytes32 orderId, uint256 fiatAmount)
        internal
        returns (address[] memory assigned)
    {
        Order storage o = s.orders[orderId];
        uint256 count;
        address[] memory temp = new address[](LibOrders.MAX_ASSIGNMENTS);
        (address[] storage pool, uint256 poolLen) = _candidatePool();

        for (uint256 i = 0; i < poolLen && count < LibOrders.MAX_ASSIGNMENTS; i++) {
            address addr = pool[i];
            Merchant storage m = s.merchants[addr];
            if (m.accountStatus != MerchantAccountStatus.ACTIVE) continue;
            if (_hasSellCapacity(m, fiatAmount)) {
                temp[count++] = addr;
                o.assignedMerchants.push(addr);
                s.orderAssignmentIndex[orderId][addr] = true;
                emit OrderAssigned(orderId, addr, block.timestamp);
            }
        }

        assigned = new address[](count);
        for (uint256 i = 0; i < count; i++) assigned[i] = temp[i];
    }

    /// @dev Pool the router iterates when picking up to 4 merchants. Uses the
    ///      admin-managed whitelist when non-empty, else the full merchant list.
    function _candidatePool() internal view returns (address[] storage pool, uint256 len) {
        if (s.eligibleMerchants.length > 0) {
            pool = s.eligibleMerchants;
        } else {
            pool = s.merchantList;
        }
        len = pool.length;
    }

    function _hasSellCapacity(Merchant storage m, uint256 fiatAmount) internal view returns (bool) {
        bytes32[] storage ids = m.channelIds;
        for (uint256 j = 0; j < ids.length; j++) {
            if (LibOrders.isSellEligibleChannel(s.channels[ids[j]], fiatAmount)) return true;
        }
        return false;
    }

    /// @dev SELL completion: consume merchant's fiat reservation, credit USDC to merchant
    ///      liquidity, but park the same amount in risk_usdc for the dispute window.
    function _completeSellOrder(Order storage o) internal {
        Merchant storage m = s.merchants[o.merchant];
        PaymentChannel storage ch = s.channels[o.channelId];

        ch.reservedFiat -= o.fiatAmount;
        ch.fiatBalance -= o.fiatAmount;
        m.usdcLiquidity += o.usdcAmount;
        m.riskUsdc += o.usdcAmount;

        o.status = OrderStatus.COMPLETED;
        o.completedAt = block.timestamp;
        o.disputeExpiresAt = block.timestamp + s.disputeWindowSeconds;

        emit OrderCompleted(o.orderId, o.merchant, block.timestamp, o.disputeExpiresAt);
    }
}
