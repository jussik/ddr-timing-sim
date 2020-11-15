(() => {
    const casCommands = ["RD", "RDA", "WR", "WRA"];

    window.update = function update() {
        const freqMhz = +i_CK.value;
        const timings = {}; // map timing names to times, e.g. {CL:14,tRCD:16,...}

        function cyclesToTime(n) {
            return parseFloat((n * 1000 / freqMhz).toFixed(1)) + "ns";
        }

        o_CK.textContent = freqMhz * 2 + " MT";
        for (let e of document.getElementsByClassName("timing")) {
            let n = +e.value;
            timings[e.name] = n;
            window["o_" + e.name].textContent = cyclesToTime(n);
        }

        let nextData, nextDataCk;
        const deferredData = []; // e.g. data burst CL cycles after RD

        function shiftData() {
            nextData = deferredData.shift();
            nextDataCk = nextData ? nextData.ck : null;
        }

        const ticks = [];
        const times = [];
        const waves = {
            CK: { wave: [] },
            Command: { wave: [], data: [] },
            DQ: { wave: [], data: [] }
        };

        let ckCounter = 0;
        let dataCounter = 0;

        function emitCommand(cmd, args = {}) {
            if (casCommands.includes(cmd)) {
                deferredData.push(
                    { offset: 0, ck: ckCounter + timings.CL },
                    { offset: 2, ck: ckCounter + timings.CL + 1 },
                    { offset: 4, ck: ckCounter + timings.CL + 2 },
                    { offset: 6, ck: ckCounter + timings.CL + 3 });
            }

            ticks.push(ckCounter);
            times.push(cyclesToTime(ckCounter));
            waves.CK.wave.push(".1.0");
            waves.Command.data.push(cmd);
            if (cmd === "DES" && args.warp) {
                ticks.push("\u21DD");
                times.push("\u21DD");
                waves.Command.wave.push("=.x|");
                waves.DQ.wave.push(".x.|");
                if (nextDataCk === ckCounter) {
                    console.error(`Warp during data burst! (time ${ckCounter})`);
                }
            } else {
                ticks.push("\u200B");
                times.push("\u200B");
                waves.Command.wave.push(cmd === "DES" ? "=.x." : "5.x.");
                if (nextDataCk === ckCounter) {
                    waves.DQ.wave.push(".=.=");
                    waves.DQ.data.push("D" + nextData.offset, "D" + (nextData.offset + 1));
                    shiftData();
                    dataCounter += 2;
                } else {
                    waves.DQ.wave.push(".x..");
                }
            }

            if (nextData && nextDataCk <= ckCounter) {
                console.error(`Data burst overlap! (time ${nextDataCk} to ${ckCounter + 1})`);
                while (nextDataCk <= ckCounter) {
                    shiftData();
                }
            }

            if (args.counter)
                ckCounter = args.counter;
            else
                ckCounter++;
        }

        function wait(time) {
            const origTime = time;
            if (isNaN(time)) {
                time = timings[time];
                if (isNaN(time)) {
                    console.error(`Invalid wait argument: ${origTime}`);
                    time = 0;
                }
            }
            time = Math.floor(time);

            if (time > 1) {
                const finalDes = ckCounter + time - 2; // generate (time - 1) DES commands
                while (ckCounter < finalDes) {
                    let waitLeft = finalDes - ckCounter;
                    if (waitLeft < 2) {
                        // short wait, skip warp
                        while (ckCounter < finalDes) {
                            emitCommand("DES");
                        }
                    } else if (!nextData) {
                        // no upcoming data, easy warp
                        emitCommand("DES", { warp: true, counter: finalDes });
                    } else {
                        // upcoming data
                        let minWarp = ckCounter + 2;
                        let nextTarget = Math.min(nextDataCk, finalDes);
                        if (nextTarget >= minWarp) {
                            // warp as far as possible
                            emitCommand("DES", { warp: true, counter: nextTarget });
                        } else {
                            // warp not possible, try again next cycle
                            emitCommand("DES");
                        }
                    }
                }
                emitCommand("DES");
            }
        }

        commands.value.split("\n").forEach((line, ln) => {
            line = line.trim();
            if (!line)
                return;
            const args = line.split(/\s+/g);
            const cmd = args.shift();

            if (!nextData) {
                shiftData();
            }

            if (cmd === "wait") {
                wait(args[0]);
            } else {
                emitCommand(cmd, args);
            }
        });

        // flush remaining data bursts
        if (!nextData) {
            shiftData();
        }
        const lastData = deferredData.length ? deferredData[deferredData.length - 1] : nextData;
        if (lastData) {
            const timeToWait = lastData.ck - ckCounter + 3;
            if (timeToWait > 1) {
                wait(timeToWait);
            }
        }

        const waveObj = {
            signal: [
                { name: 'CK', wave: 'l.' + waves.CK.wave.join(""), period: 0.5, phase: 0.675 },
                { name: "Command", wave: "x" + waves.Command.wave.join(""), data: waves.Command.data, period: 0.5, phase: 0.125 },
                { name: 'DQ', wave: "x" + waves.DQ.wave.join(""), data: waves.DQ.data, period: 0.5, phase: 0.125 }
            ],
            head: { tick: ["\u200B " + ticks.join(" ") + " \u200B"] },
            foot: { tick: ["\u200B " + times.join(" ") + " \u200B"] }
        };
        signaljson.textContent = JSON.stringify(waveObj, null, 2);
        WaveDrom.RenderWaveForm(0, waveObj, "wave", false);

        const suffix = ["", "K", "M", "G", "T"];
        function formatSi(n) {
            const logDivisor = Math.min(Math.floor(Math.log10(n) / 3), suffix.length - 1);
            return parseFloat((n / Math.pow(10, 3 * logDivisor)).toFixed(1)) + suffix[logDivisor];
        }

        const bitsPerSecond = dataCounter * freqMhz * 1000000 / ckCounter;
        summary.textContent = `${formatSi(dataCounter)}b in ${cyclesToTime(ckCounter)}, ${formatSi(bitsPerSecond)}b/s`;
    }

    update();
})();
