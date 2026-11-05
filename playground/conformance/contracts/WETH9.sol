// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

/**
 * @title WETH9 for the playground conformance harness
 * @dev A line-by-line port of the canonical WETH9 (mainnet 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
 *      Solidity 0.4.18) to 0.8, so the harness can deploy "Wrapped Ether" without a compiler for 0.4.
 *      Kept identical where it is observable from a Safe:
 *      - storage layout (name, symbol, decimals, balanceOf at slot 3, allowance at slot 4);
 *      - events;
 *      - every failed check is a bare `require` (empty revert data), and each subtraction is guarded
 *        first, so checked arithmetic never panics;
 *      - `deposit()` and the payable fallback (any unknown calldata, or none) credit `msg.value`;
 *      - `withdraw` pays out with `transfer` (2300 gas stipend);
 *      - an infinite allowance (`type(uint256).max`) is not decreased by `transferFrom`.
 *      Not part of the policy engine; only `playground/conformance` uses it.
 */
contract WETH9 {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    event Approval(address indexed src, address indexed guy, uint256 wad);
    event Transfer(address indexed src, address indexed dst, uint256 wad);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    receive() external payable {
        deposit();
    }

    fallback() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        require(balanceOf[msg.sender] >= wad);
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    function totalSupply() public view returns (uint256) {
        return address(this).balance;
    }

    function approve(address guy, uint256 wad) public returns (bool) {
        allowance[msg.sender][guy] = wad;
        emit Approval(msg.sender, guy, wad);
        return true;
    }

    function transfer(address dst, uint256 wad) public returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        require(balanceOf[src] >= wad);

        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= wad);
            allowance[src][msg.sender] -= wad;
        }

        balanceOf[src] -= wad;
        balanceOf[dst] += wad;

        emit Transfer(src, dst, wad);

        return true;
    }
}
