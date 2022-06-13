// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.8.0;

import './CompoundStrategy.sol';

/**
 * @title CompoundStrategyFactory
 * @dev Factory contract to create CompoundStrategy contracts
 */
contract CompoundStrategyFactory {
    /**
     * @dev Emitted every time a new CompoundStrategy is created
     */
    event StrategyCreated(CompoundStrategy indexed strategy);

    IVault public vault;

    /**
     * @dev Initializes the factory contract
     * @param _vault Protocol vault reference
     */
    constructor(IVault _vault) {
        vault = _vault;
    }

    /**
     * @dev Creates a new CompoundStrategy
     * @param token Token to be used as the strategy entry point
     * @param cToken Compound token associated to the strategy token
     * @param slippage Slippage value to be used in order to swap rewards
     * @param metadata Metadata URI associated to the strategy
     */
    function create(IERC20 token, ICToken cToken, uint256 slippage, string memory metadata)
        external
        returns (CompoundStrategy strategy)
    {
        strategy = new CompoundStrategy(vault, token, cToken, slippage, metadata);
        strategy.transferOwnership(msg.sender);
        emit StrategyCreated(strategy);
    }
}
