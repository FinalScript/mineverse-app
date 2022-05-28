import { NextPage } from 'next';
import Head from 'next/head';
import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { BlockchainState } from '../types';
import { contractAddresses, siteProtection } from '../config';
import Web3 from 'web3';
import BigNumber from 'bignumber.js';
import Vault from '../components/Vault';

const fmt = {
    decimalSeparator: '.',
    groupSeparator: ',',
    groupSize: 3,
    secondaryGroupSize: 0,
    fractionGroupSeparator: ' ',
    fractionGroupSize: 0,
};

// Set the global formatting options
BigNumber.config({ FORMAT: fmt });

const game: NextPage = () => {
    const blockchain = useSelector((state: BlockchainState) => state.blockchain);

    const [generalData, setGeneralData] = useState<any[]>([]);

    const [miners, setMiners] = useState<number[]>([]);
    const [selectedMiners, setSelectedMiners] = useState<number[]>([]);

    const [staked, setStaked] = useState<number[]>([]);
    const [selectedStaked, setSelectedStaked] = useState<number[]>([]);
    const [stakedData, setStakedData] = useState<any>({});

    const [cooldowns, setCooldowns] = useState<number[]>([]);
    const [selectedCooldowns, setSelectedCooldowns] = useState<number[]>([]);
    const [cooldownsData, setCooldownsData] = useState<any>({});
    const cooldownRemainingInterval = useRef<any>();

    const [myDiamonds, setMyDiamonds] = useState<BigNumber>();
    const [earnedDiamonds, setEarnedDiamonds] = useState<BigNumber>();
    const earnedDiamondsInterval = useRef<any>();

    const [form, setForm] = useState({ level: 0, quantity: 0 });

    useEffect(() => {
        setMiners([]);

        if (blockchain.minerContract && blockchain.account) {
            getMyMiners();
        }
    }, [blockchain.minerContract, blockchain.account]);

    useEffect(() => {
        setStaked([]);

        if (blockchain.mineContract && blockchain.account) {
            getStaked();
        }

        setCooldowns([]);

        if (blockchain.mineContract && blockchain.account) {
            getCooldowns();
        }
    }, [blockchain.mineContract, blockchain.account]);

    useEffect(() => {
        getMyDiamonds();
    }, [blockchain.diamondContract, blockchain.account]);

    const getMyDiamonds = async () => {
        let diamonds = 0;

        if (blockchain.diamondContract?.methods && blockchain.account) {
            diamonds = await blockchain.diamondContract?.methods.balanceOf(blockchain.account).call();
        }

        setMyDiamonds(new BigNumber(Web3.utils.fromWei(diamonds.toString())));
    };

    const getMyMiners = async () => {
        const minersState = [];

        if (blockchain.minerContract?.methods && blockchain.account) {
            const numMiners = await blockchain.minerContract?.methods.balanceOf(blockchain.account).call();

            if (numMiners !== 0) {
                const miners = await blockchain.minerContract.methods.batchedMinerOfOwner(blockchain.account, 0, numMiners).call();

                if (miners) {
                    for (const miner of miners) {
                        minersState.push(parseInt(miner['tokenId']));

                        setGeneralData((prevState: any) => {
                            return { ...prevState, [miner.tokenId]: { ...prevState[miner.tokenId], level: parseInt(miner.level) } };
                        });
                    }

                    minersState.sort((a, b) => a - b);
                }
            }
        }

        setMiners(minersState);
    };

    const getStaked = async () => {
        const minersState = [];
        clearTimeout(earnedDiamondsInterval.current);
        setEarnedDiamonds(new BigNumber(0));

        if (blockchain.mineContract?.methods && blockchain.account) {
            const numMiners = await blockchain.mineContract?.methods.ownedStakesBalance(blockchain.account).call();

            if (numMiners !== 0) {
                const miners = await blockchain.mineContract.methods.batchedStakesOfOwner(blockchain.account, 0, numMiners).call();

                if (miners) {
                    for (const miner of miners) {
                        minersState.push(parseInt(miner['tokenId']));

                        setGeneralData((prevState: any) => {
                            return { ...prevState, [miner.tokenId]: { ...prevState[miner.tokenId], level: parseInt(miner.level) } };
                        });
                    }
                    const yieldDps = await blockchain.mineContract?.methods.YIELD_CPS().call();

                    earnedDiamondsInterval.current = setInterval(
                        () => {
                            let totalAcccrued = new BigNumber(0);

                            for (const miner of miners) {
                                const accrued = new BigNumber(
                                    Web3.utils.fromWei(
                                        new BigNumber(
                                            (Math.round(Date.now() - Math.round(miner.startTimestamp * 1000)) *
                                                (miner.level === '0' ? 1 : 25) *
                                                parseFloat(yieldDps)) /
                                                1000
                                        ).toFixed(0),
                                        'ether'
                                    )
                                );

                                setStakedData((prevState: any) => {
                                    return { ...prevState, [miner.tokenId]: { ...prevState[miner.tokenId], earned: accrued } };
                                });

                                totalAcccrued = totalAcccrued.plus(accrued);
                            }

                            setEarnedDiamonds(totalAcccrued);
                        },
                        miners.length > 15 ? 80 : 150
                    );

                    // getEarnedDiamonds(stakedIds);

                    minersState.sort((a, b) => a - b);
                }
            }
        }

        setStaked(minersState);
    };

    const getCooldowns = async () => {
        const cooldownsState: any = [];
        clearTimeout(cooldownRemainingInterval.current);

        if (blockchain.mineContract?.methods && blockchain.account) {
            const numMiners = await blockchain.mineContract?.methods.ownedCooldownsBalance(blockchain.account).call();

            if (numMiners !== 0) {
                const cooldowns = await blockchain.mineContract.methods.batchedCooldownsOfOwner(blockchain.account, 0, numMiners).call();
                const unstakeCooldownDuration = await blockchain.mineContract?.methods.UNSTAKE_COOLDOWN_DURATION().call();

                if (cooldowns) {
                    for (const cooldown of cooldowns) {
                        cooldownsState.push(parseInt(cooldown['tokenId']));

                        setGeneralData((prevState: any) => {
                            return { ...prevState, [cooldown.tokenId]: { ...prevState[cooldown.tokenId], level: parseInt(cooldown.level) } };
                        });
                    }

                    updateRemainingCooldownTime(cooldowns, unstakeCooldownDuration);

                    cooldownRemainingInterval.current = setInterval(
                        () => {
                            updateRemainingCooldownTime(cooldowns, unstakeCooldownDuration);
                        },
                        cooldowns.length < 15 ? 1000 : 60000
                    );
                }
            }
        }

        setCooldowns(cooldownsState);
    };

    const updateRemainingCooldownTime = (cooldowns: any, unstakeCooldownDuration: any) => {
        for (const cooldown of cooldowns) {
            const futureTime = new Date((parseInt(cooldown.startTimestamp) + parseInt(unstakeCooldownDuration)) * 1000);

            const timeLeft = futureTime.getTime() - new Date().getTime();

            const timeRemaining = {
                h: Math.floor(timeLeft / 1000 / 60 / 60),
                m: Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60)),
                s: cooldowns.length < 15 ? Math.floor((timeLeft % (1000 * 60)) / 1000) : null,
            };

            setCooldownsData((prevState: any) => {
                return {
                    ...prevState,
                    [cooldown.tokenId]: {
                        ...prevState[cooldown.tokenId],
                        timeDiff: timeLeft,
                        timeRemaining,
                        withdraw: timeLeft > 0 ? false : true,
                    },
                };
            });
        }
    };

    const claimDiamonds = async () => {
        if (blockchain.diamondContract?.methods && blockchain.mineContract?.methods && blockchain.account) {
            blockchain.mineContract?.methods
                .claimDiamondsAndMaybeUnstake(staked, false)
                .send({
                    to: contractAddresses.mine,
                    from: blockchain.account,
                    value: 0,
                })
                .once('sending', function (payload: any) {
                    console.log(payload);
                })
                .once('sent', function (payload: any) {
                    console.log(payload);
                })
                .once('transactionHash', function (hash: any) {
                    console.log(hash);
                })
                .once('receipt', function (hash: any) {
                    getStaked();

                    getMyDiamonds();
                })
                .on('error', function (error: any) {
                    console.log(error);
                })
                .then((res: any) => {
                    console.log(res);
                })
                .catch((err: any) => {
                    console.log(err);
                });
        }
    };

    const stake = async () => {
        if (blockchain.mineContract?.methods && blockchain.account) {
            const isApproved = await blockchain.minerContract?.methods.isApprovedForAll(blockchain.account, contractAddresses.mine).call();

            if (isApproved) {
                blockchain.mineContract?.methods
                    .stakeMany(selectedMiners)
                    .send({
                        to: contractAddresses.mine,
                        from: blockchain.account,
                        value: 0,
                    })
                    .once('receipt', function (hash: any) {
                        getStaked();

                        getMyMiners();
                    })
                    .catch((err: any) => {
                        console.log(err);
                    });
            } else {
                blockchain.minerContract?.methods
                    .setApprovalForAll(contractAddresses.mine, true)
                    .send({
                        to: contractAddresses.mine,
                        from: blockchain.account,
                        value: 0,
                    })
                    .then(() => {
                        blockchain.mineContract?.methods
                            .stakeMany(selectedMiners)
                            .send({
                                to: contractAddresses.mine,
                                from: blockchain.account,
                                value: 0,
                            })
                            .once('receipt', function (hash: any) {
                                getStaked();

                                getMyMiners();
                            })
                            .catch((err: any) => {
                                console.log(err);
                            });
                    });
            }
        }
    };

    const unstake = async () => {
        if (blockchain.diamondContract?.methods && blockchain.mineContract?.methods && blockchain.account) {
            blockchain.mineContract?.methods
                .claimDiamondsAndMaybeUnstake(selectedStaked, true)
                .send({
                    to: contractAddresses.mine,
                    from: blockchain.account,
                    value: 0,
                })
                .once('receipt', function (hash: any) {
                    getStaked();
                    getMyDiamonds();
                    getCooldowns();
                })
                .catch((err: any) => {
                    console.log(err);
                });
        }
    };

    const withdraw = async () => {
        if (blockchain.mineContract?.methods && blockchain.account) {
            blockchain.mineContract?.methods
                .withdrawMiner(selectedCooldowns)
                .send({
                    to: contractAddresses.mine,
                    from: blockchain.account,
                    value: 0,
                })
                .once('receipt', function (hash: any) {
                    getMyMiners();

                    getCooldowns();
                })
                .catch((err: any) => {
                    console.log(err);
                });
        }
    };

    const mintUpgrade = async () => {
        if (blockchain.minerContract?.methods && blockchain.account) {
            const isApproved = await blockchain.minerContract?.methods.isApprovedForAll(blockchain.account, contractAddresses.miner).call();

            if (isApproved) {
                blockchain.minerContract?.methods
                    .mintUpgrade(form.level, form.quantity)
                    .send({
                        to: contractAddresses.miner,
                        from: blockchain.account,
                        value: 0,
                    })
                    .once('receipt', function (hash: any) {
                        console.log(hash);
                    })
                    .catch((err: any) => {
                        console.log(err);
                    });
            } else {
                blockchain.minerContract?.methods
                    .setApprovalForAll(contractAddresses.miner, true)
                    .send({
                        to: contractAddresses.miner,
                        from: blockchain.account,
                        value: 0,
                    })
                    .once('receipt', (hash: any) => {
                        blockchain.minerContract?.methods
                            .mintUpgrade(form.level, form.quantity)
                            .send({
                                to: contractAddresses.miner,
                                from: blockchain.account,
                                value: 0,
                            })
                            .once('receipt', function (hash: any) {
                                console.log(hash);
                            })
                            .catch((err: any) => {
                                console.log(err);
                            });
                    });
            }
        }
    };

    if (
        siteProtection.whitelistOnly &&
        !siteProtection.whitelistedWallets.find((address) => address.toLowerCase() === blockchain.account?.toLowerCase() || '')
    ) {
        return <></>;
    }

    return (
        <>
            <Head>
                <title>Game | MinerVerse</title>
            </Head>

            <section className='text-gray-900 bg-gray-900 body-font h-full'>
                <div className='flex flex-col justify-center items-center space-y-5 overflow-auto pt-44 pb-11'>
                    {/* <div className='px-11 flex flex-col items-center space-y-3 text-xl text-center bg-gray-700 text-white shadow-lg p-2 rounded-lg'>
                        <div>
                            <label>Level</label>
                            <input
                                value={form.level}
                                onChange={(e) => {
                                    setForm((prevState: any) => {
                                        return { ...prevState, level: e.target.value };
                                    });
                                }}
                                type='number'
                                max={20000}
                                placeholder='0'
                                className='text-center border-none outline-none ml-3 w-[200px] bg-gray-700 text-white'
                            />
                        </div>
                        <div>
                            <label>Quantity</label>
                            <input
                                value={form.quantity}
                                onChange={(e) => {
                                    setForm((prevState: any) => {
                                        return { ...prevState, quantity: e.target.value };
                                    });
                                }}
                                type='number'
                                max={20000}
                                placeholder='0'
                                className='text-center border-none outline-none ml-3 w-[200px] bg-gray-700 text-white'
                            />
                        </div>
                        <button onClick={mintUpgrade} className='ml-4 bg-rose-500 rounded-lg p-2 px-4'>
                            Mint Upgrade
                        </button>
                    </div> */}
                    <div className='flex space-x-5'>
                        <div className='text-xl text-center flex flex-col items-center bg-gray-700 text-white shadow-lg p-6 px-11 w-[400px] rounded-lg'>
                            <div className='flex'>
                                <h5 className='flex flex-col items-start w-[100px]'>
                                    <span>Balance: </span>
                                    <span>Earned: </span>
                                </h5>
                                <div className='relative w-[100px]'>
                                    <h5 className='flex flex-col items-start absolute top-0 left-0 whitespace-nowrap'>
                                        <span>{myDiamonds?.toFormat(5)}</span>
                                        <span>{earnedDiamonds?.toFormat(5)}</span>
                                    </h5>
                                </div>
                            </div>
                            <button
                                disabled={earnedDiamonds?.eq(0)}
                                onClick={claimDiamonds}
                                className='mt-4 py-1 px-3 bg-rose-500 disabled:hover:bg-rose-500 hover:bg-rose-600 rounded-md'>
                                Claim
                            </button>
                        </div>
                        <Vault vaultContract={blockchain.vaultContract} account={blockchain.account} />
                    </div>
                    <div className='px-11 text-center w-full'>
                        <div className='flex items-center justify-between w-full mb-4 p-2 px-3 bg-gray-700 text-white rounded-lg shadow-lg'>
                            <h3 className='font-bold text-xl'>Staked</h3>
                            <div className='flex space-x-3'>
                                <button
                                    onClick={() => {
                                        setSelectedStaked([]);
                                    }}
                                    className='py-1 px-3 bg-gray-400 hover:bg-gray-500 rounded-md'>
                                    Unselect
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectedStaked([...staked]);
                                    }}
                                    className='py-1 px-3 bg-gray-400 hover:bg-gray-500 rounded-md'>
                                    Select All
                                </button>
                                <button
                                    disabled={selectedStaked.length === 0}
                                    onClick={unstake}
                                    className='py-1 px-3 bg-rose-500 disabled:hover:bg-rose-500 hover:bg-rose-600 rounded-md'>
                                    Unstake
                                </button>
                            </div>
                        </div>
                        <div
                            className='flex flex-wrap justify-center'
                            onContextMenu={(e) => {
                                e.preventDefault();
                            }}>
                            {staked.map((token: any) => {
                                return (
                                    <div
                                        key={token}
                                        onMouseDown={(e) => {
                                            e.preventDefault();

                                            if (e.buttons == 1 || e.buttons == 3) {
                                                const index = selectedStaked.indexOf(token);

                                                if (index > -1) {
                                                    setSelectedStaked(selectedStaked.filter((item) => item !== token));
                                                } else {
                                                    setSelectedStaked([...selectedStaked, token]);
                                                }
                                            }
                                        }}
                                        onMouseEnter={(e) => {
                                            e.preventDefault();

                                            if (e.buttons == 1 || e.buttons == 3) {
                                                const index = selectedStaked.indexOf(token);

                                                if (index > -1) {
                                                    setSelectedStaked(selectedStaked.filter((item) => item !== token));
                                                } else {
                                                    setSelectedStaked([...selectedStaked, token]);
                                                }
                                            }
                                        }}
                                        className={
                                            'relative shadow-lg p-4 mr-1 mb-1 w-[100px] cursor-pointer select-none ' +
                                            (generalData[token]?.level === 1 ? ' text-red-500 ' : 'text-white ') +
                                            (selectedStaked.indexOf(token) !== -1 ? ' bg-gray-500' : 'bg-gray-700')
                                        }>
                                        <div className='flex flex-col items-center'>
                                            <p className='text-lg'>{token}</p>
                                            {stakedData[token]?.earned && <p className='text-sm text-gray-300'>{stakedData[token].earned.toFixed(3)}</p>}
                                        </div>
                                        {/* <div className='w-[100px] h-[200px]'>
                                <img src={miner.image} className='object-cover w-full h-full' />
                            </div> */}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className='px-11 text-center w-full'>
                        <div className='flex items-center justify-between w-full mb-4 p-2 px-3 bg-gray-700 text-white rounded-lg shadow-lg'>
                            <h3 className='font-bold text-xl'>Not Staked</h3>
                            <div className='flex space-x-3'>
                                <button
                                    onClick={() => {
                                        setSelectedMiners([]);
                                    }}
                                    className='py-1 px-3 bg-gray-400 hover:bg-gray-500 rounded-md'>
                                    Unselect
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectedMiners([...miners]);
                                    }}
                                    className='py-1 px-3 bg-gray-400 hover:bg-gray-500 rounded-md'>
                                    Select All
                                </button>
                                <button
                                    disabled={selectedMiners.length === 0}
                                    onClick={stake}
                                    className='py-1 px-3 bg-rose-500 disabled:hover:bg-rose-500 hover:bg-rose-600 rounded-md'>
                                    Stake
                                </button>
                            </div>
                        </div>
                        <div
                            className='flex flex-wrap justify-center'
                            onContextMenu={(e) => {
                                e.preventDefault();
                            }}>
                            {miners.map((token: any) => {
                                return (
                                    <div
                                        key={token}
                                        onMouseDown={(e) => {
                                            e.preventDefault();

                                            if (e.buttons == 1 || e.buttons == 3) {
                                                const index = selectedMiners.indexOf(token);

                                                if (index > -1) {
                                                    setSelectedMiners(selectedMiners.filter((item) => item !== token));
                                                } else {
                                                    setSelectedMiners([...selectedMiners, token]);
                                                }
                                            }
                                        }}
                                        onMouseEnter={(e) => {
                                            e.preventDefault();

                                            if (e.buttons == 1 || e.buttons == 3) {
                                                const index = selectedMiners.indexOf(token);

                                                if (index > -1) {
                                                    setSelectedMiners(selectedMiners.filter((item) => item !== token));
                                                } else {
                                                    setSelectedMiners([...selectedMiners, token]);
                                                }
                                            }
                                        }}
                                        className={
                                            'relative shadow-lg p-4 mr-1 mb-1 w-[100px] cursor-pointer select-none ' +
                                            (generalData[token]?.level === 1 ? ' text-red-500 ' : 'text-white ') +
                                            (selectedMiners.indexOf(token) !== -1 ? ' bg-gray-500' : 'bg-gray-700')
                                        }>
                                        <p className=''>{token}</p>
                                        {/* <div className='w-[100px] h-[200px]'>
                                <img src={miner.image} className='object-cover w-full h-full' />
                            </div> */}
                                    </div>
                                );
                            })}
                        </div>
                    </div>{' '}
                    <div className='px-11 text-center w-full'>
                        <div className='flex items-center justify-between w-full mb-4 p-2 px-3 bg-gray-700 text-white rounded-lg shadow-lg'>
                            <h3 className='font-bold text-xl'>Cooldown</h3>
                            <div className='flex space-x-3'>
                                <button
                                    onClick={() => {
                                        setSelectedCooldowns([]);
                                    }}
                                    className='py-1 px-3 bg-gray-400 hover:bg-gray-500 rounded-md'>
                                    Unselect
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectedCooldowns([...cooldowns]);
                                    }}
                                    className='py-1 px-3 bg-gray-400 hover:bg-gray-500 rounded-md'>
                                    Select All
                                </button>
                                <button
                                    disabled={selectedCooldowns.length === 0}
                                    onClick={withdraw}
                                    className='py-1 px-3 bg-rose-500 disabled:hover:bg-rose-500 hover:bg-rose-600 rounded-md'>
                                    Withdraw
                                </button>
                            </div>
                        </div>
                        <div className='flex flex-wrap justify-center'>
                            {cooldowns.map((token: any) => {
                                return (
                                    <div
                                        key={token}
                                        onMouseDown={(e) => {
                                            e.preventDefault();

                                            if (e.buttons == 1 || e.buttons == 3) {
                                                const index = selectedCooldowns.indexOf(token);

                                                if (index > -1) {
                                                    setSelectedCooldowns(selectedCooldowns.filter((item) => item !== token));
                                                } else {
                                                    setSelectedCooldowns([...selectedCooldowns, token]);
                                                }
                                            }
                                        }}
                                        onMouseEnter={(e) => {
                                            e.preventDefault();

                                            if (e.buttons == 1 || e.buttons == 3) {
                                                const index = selectedCooldowns.indexOf(token);

                                                if (index > -1) {
                                                    setSelectedCooldowns(selectedCooldowns.filter((item) => item !== token));
                                                } else {
                                                    setSelectedCooldowns([...selectedCooldowns, token]);
                                                }
                                            }
                                        }}
                                        className={
                                            'relative shadow-lg p-4 mr-1 mb-1 w-[120px] cursor-pointer select-none ' +
                                            (generalData[token]?.level === 1 ? ' text-red-500 ' : 'text-white ') +
                                            (selectedCooldowns.indexOf(token) !== -1 ? ' bg-gray-500' : 'bg-gray-700')
                                        }>
                                        <p className='text-lg'>{token}</p>
                                        {cooldownsData[token]?.timeRemaining && !cooldownsData[token]?.withdraw ? (
                                            <p className='text-sm text-gray-300 flex space-x-1 justify-center'>
                                                {cooldownsData[token].timeRemaining.h && <span>{cooldownsData[token].timeRemaining.h}h</span>}
                                                {cooldownsData[token].timeRemaining.m && <span>{cooldownsData[token].timeRemaining.m}m</span>}
                                                {cooldownsData[token].timeRemaining.s && <span>{cooldownsData[token].timeRemaining.s}s</span>}
                                            </p>
                                        ) : (
                                            <p className='text-sm text-green-500 flex space-x-1 justify-center'>Ready!</p>
                                        )}
                                        {/* <div className='w-[100px] h-[200px]'>
                                <img src={miner.image} className='object-cover w-full h-full' />
                            </div> */}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
};

export default game;