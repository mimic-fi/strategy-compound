import { expect } from 'chai'
import { Contract } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address'
import { deploy, fp, bn, impersonateWhale, instanceAt } from '@mimic-fi/v1-helpers'
import { incrementBlock } from './helpers/network'

describe('CompoundStrategy - Join', function () {
  let whale: SignerWithAddress, vault: Contract, strategy: Contract, dai: Contract, cdai: Contract, comp: Contract, usdc: Contract

  const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
  const CDAI = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643'
  const COMP = '0xc00e94cb662c3520282e6f5717214004a7f26888'
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const UNISWAP_V2_ROUTER_ADDRESS = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

  const MAX_UINT_256 = bn(2).pow(256).sub(1)
  const MAX_UINT_96 = bn(2).pow(96).sub(1)

  before('load signers', async () => {
    whale = await impersonateWhale(fp(100))
  })

  before('deploy vault', async () => {
    const protocolFee = fp(0.00003)
    const whitelistedStrategies: string[] = []

    const swapConnector = await deploy('UniswapConnector', [UNISWAP_V2_ROUTER_ADDRESS])

    vault = await deploy('Vault', [protocolFee, swapConnector.address, whitelistedStrategies])
  })

  before('load tokens', async () => {
    dai = await instanceAt('IERC20', DAI)
    cdai = await instanceAt('ICToken', CDAI)
    comp = await instanceAt('IERC20', COMP)
    usdc = await instanceAt('IERC20', USDC)
  })

  before('deposit to Vault', async () => {
    await dai.connect(whale).approve(vault.address, fp(100))
    await vault.connect(whale).deposit(whale.address, [dai.address], [fp(100)])
  })

  before('deploy strategy', async () => {
    strategy = await deploy('CompoundStrategy', [vault.address, dai.address, cdai.address, 'metadata:uri'])
  })

  it('vault has max DAI allowance', async () => {
    const allowance = await dai.allowance(strategy.address, vault.address)
    expect(allowance).to.be.equal(MAX_UINT_256)
  })

  it('join strategy', async () => {
    const amount = fp(50)

    const previousVaultBalance = await dai.balanceOf(vault.address)

    const previousStrategyBalance = await dai.balanceOf(strategy.address)
    expect(previousStrategyBalance).to.be.equal(0)

    await vault.connect(whale).join(whale.address, strategy.address, amount, '0x')

    const currentVaultBalance = await dai.balanceOf(vault.address)
    expect(currentVaultBalance).to.be.equal(previousVaultBalance.sub(amount))

    const currentStrategyBalance = await dai.balanceOf(strategy.address)
    expect(currentStrategyBalance).to.be.equal(previousStrategyBalance)

    const currentInvestment = await vault.getAccountInvestment(whale.address, strategy.address)
    expect(currentInvestment[0]).to.be.equal(amount)
    expect(currentInvestment[1].gt(0)).to.be.true

    const cdaiBalance = await cdai.balanceOf(strategy.address)
    const totalShares = await strategy.getTotalShares()
    expect(totalShares).to.be.equal(cdaiBalance)
  })

  it('has strategy gains', async () => {
    const initialBalance = await strategy.getTokenBalance()

    //Increments blocks
    await incrementBlock(400)
    //Force update of rate
    await cdai.connect(whale).exchangeRateCurrent()

    const finalBalance = await strategy.getTokenBalance()
    expect(finalBalance.gt(initialBalance)).to.be.true
  })

  it('exit strategy', async () => {
    const initialAmount = fp(50)
    const initialBalance = await vault.getAccountBalance(whale.address, dai.address)

    await vault.connect(whale).exit(whale.address, strategy.address, fp(1), '0x')

    const currentBalance = await vault.getAccountBalance(whale.address, dai.address)
    const finalAmount = currentBalance.sub(initialBalance)

    expect(finalAmount.gt(initialAmount)).to.be.true

    const currentStrategyBalance = await dai.balanceOf(strategy.address)
    expect(currentStrategyBalance).to.be.equal(0)

    const currentInvestment = await vault.getAccountInvestment(whale.address, strategy.address)

    expect(currentInvestment[0]).to.be.equal(0)
    expect(currentInvestment[1]).to.be.equal(0)

    const cdaiBalance = await cdai.balanceOf(strategy.address)
    expect(cdaiBalance).to.be.equal(0)

    const totalShares = await strategy.getTotalShares()
    expect(totalShares).to.be.equal(0)
  })

  it('can give allowance to other tokens', async () => {
    await strategy.approveVault(comp.address)

    //Max allowance for COMP token is uint96(-1)
    const allowance = await comp.allowance(strategy.address, vault.address)
    expect(allowance).to.be.equal(MAX_UINT_96)
  })

  it('cannot give CDAI allowance to vault ', async () => {
    await expect(strategy.approveVault(cdai.address)).to.be.revertedWith('COMPOUND_INTERNAL_TOKEN')
  })

  it('handle DAI airdrops', async () => {
    //airdrop 1000
    dai.connect(whale).transfer(strategy.address, fp(1000))

    //total shares = cdai
    const initialCdaiBalance = await cdai.balanceOf(strategy.address)
    const initialShares = await strategy.getTotalShares()

    expect(initialShares).to.be.equal(initialCdaiBalance)

    //invest aidrop
    await strategy.investAll()

    //total shares < bpt
    const finalCdaiBalance = await cdai.balanceOf(strategy.address)
    const finalShares = await strategy.getTotalShares()

    expect(initialCdaiBalance.lt(finalCdaiBalance)).to.be.true
    expect(initialShares).to.be.equal(finalShares)
  })

  it('handle USDC airdrops', async () => {
    //airdrop 1000
    usdc.connect(whale).transfer(strategy.address, fp(1000).div(bn('1e12')))

    const daiBalance = await dai.balanceOf(strategy.address)
    expect(daiBalance).to.be.equal(0)

    const initialCdaiBalance = await cdai.balanceOf(strategy.address)
    const initialShares = await strategy.getTotalShares()

    //invest aidrop
    await strategy.tradeAndInvest(usdc.address)

    const finalCdaiBalance = await cdai.balanceOf(strategy.address)
    const finalShares = await strategy.getTotalShares()

    expect(initialCdaiBalance.lt(finalCdaiBalance)).to.be.true
    expect(initialShares).to.be.equal(finalShares)
  })

  it('handle DAI airdrops + Join', async () => {
    //Make it so there are some previous shares
    await vault.connect(whale).join(whale.address, strategy.address, fp(50), '0x')

    const aidrop = fp(100000)
    const joinAmount = fp(50)

    const daiBalance = await dai.balanceOf(strategy.address)
    expect(daiBalance).to.be.equal(0)

    //airdrop 1000
    dai.connect(whale).transfer(strategy.address, aidrop)

    const initialShares = await strategy.getTotalShares()

    //whale joins
    await vault.connect(whale).join(whale.address, strategy.address, joinAmount, '0x')

    //Final token balance includes 100k airdrop + joinAmount
    const finalTokenBalance = await strategy.getTokenBalance()
    const finalShares = await strategy.getTotalShares()

    const whaleSharesExpected = joinAmount.mul(initialShares).div(finalTokenBalance)
    const whaleSharesObtained = finalShares.sub(initialShares)

    //shares obtained by the whale should be close to how much dai it addd and not the airdropped one
    expect(whaleSharesExpected.sub(whaleSharesObtained).abs().lt(fp(0.0001))).to.be.true
  })
})
