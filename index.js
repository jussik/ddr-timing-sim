(() => {
    const casCommands = ["RD", "RDA", "WR", "WRA"];

    const posSuffix = ["", "k", "M", "G", "T", "P"];
    const negSuffix = ["m", "\u00b5", "n", "p"];
    window.formatSi = function formatSi(n) {
        if (typeof(n) !== "number")
            return n;
        if (n === 0)
            return "0";
        let logDivisor = Math.floor(Math.log10(n) / 3);
        if (logDivisor >= 0) {
            logDivisor = Math.min(logDivisor, posSuffix.length - 1);
            return parseFloat((n / Math.pow(10, 3 * logDivisor)).toFixed(1)) + posSuffix[logDivisor];
        } else {
            logDivisor = 0 - logDivisor;
            if (logDivisor > negSuffix.length)
                return "0";
            return parseFloat((n * Math.pow(10, 3 * logDivisor)).toFixed(1)) + negSuffix[logDivisor - 1];
        }
    }

    function cyclesToTime(n, freqMhz) {
        if (typeof(n) !== "number")
            return n;
        return formatSi(n / (freqMhz * 1000000)) + "s";
    }

    let state = null;

    window.update = function update() {
        const freqMhz = +i_CK.value;

        const ticks = [];
        const waves = { CK: [], Command: [], DQ: [] };
        state = { waves, ticks, freqMhz };

        o_CK.textContent = freqMhz * 2 + "MT/s";
        const timings = {}; // map timing names to times, e.g. {CL:14,tRCD:16,...}
        for (let e of document.getElementsByClassName("timing")) {
            let n = +e.value;
            timings[e.name] = n;
            window["o_" + e.name].textContent = cyclesToTime(n, freqMhz);
        }

        let nextData, nextDataCk;
        const deferredData = []; // e.g. data burst CL cycles after RD
        // increment the nextData pointer
        function shiftData() {
            nextData = deferredData.shift();
            nextDataCk = nextData ? nextData.ck : null;
        }

        let ckCounter = 0;
        let dataCounter = 0;

        // add a single command to the state
        function emitCommand(cmd, args = {}) {
            if (casCommands.includes(cmd)) {
                deferredData.push(
                    { offset: 0, ck: ckCounter + timings.CL },
                    { offset: 2, ck: ckCounter + timings.CL + 1 },
                    { offset: 4, ck: ckCounter + timings.CL + 2 },
                    { offset: 6, ck: ckCounter + timings.CL + 3 });
            }

            ticks.push(ckCounter);
            waves.CK.push(".1.0");
            const command = { data: cmd };
            waves.Command.push(command);
            if (cmd === "DES" && args.warp) {
                ticks.push("\u21DD");
                command.wave = "=.x|";
                waves.DQ.push(".x.|");
                if (nextDataCk === ckCounter) {
                    console.error(`Warp during data burst! (time ${ckCounter})`);
                }
            } else {
                ticks.push("\u200B");
                command.wave = cmd === "DES" ? "=.x." : "5.x.";
                if (nextDataCk === ckCounter) {
                    waves.DQ.push({ wave: ".=.=", data: [`D${nextData.offset}`, `D${nextData.offset + 1}`] });
                    shiftData();
                    dataCounter += 2;
                } else {
                    waves.DQ.push(".x..");
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

        // wait a specified number of cycles
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

        // fill state from command text
        commands.value.split("\n").forEach((line, ln) => {
            line = line.trim();
            if (!line)
                return;
            const args = line.split(/\s+/g);
            const cmd = args.shift().toUpperCase();

            if (!nextData) {
                shiftData();
            }

            if (cmd === "WAIT") {
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

        const bitsPerSecond = dataCounter * freqMhz * 1000000 / ckCounter;
        summary.textContent = `${formatSi(dataCounter)}b in ${cyclesToTime(ckCounter, freqMhz)}, ${formatSi(bitsPerSecond)}b/s`;

        render();
    }

    function render() {
        if (!state)
            return;

        ({ waves, ticks, freqMhz } = state);

        waveContainer.innerHTML = "";
        const chunkLength = Math.floor((form.clientWidth - 120) / 80); // 120px for headings, 80px for each cycle
        const chunkCount = Math.ceil(waves.CK.length / chunkLength);
        let cutOffData = null;
        for (let waveIndex = 0; waveIndex < chunkCount; waveIndex++) {
            const signal = [];
            const startIndex = chunkLength * waveIndex;
            const endIndex = startIndex + chunkLength;
            for (let waveName in waves) {
                let chunk = waves[waveName].slice(startIndex, endIndex);
                let wave = chunk.map(o => o.wave || o).join("");
                let waveStart, data, phase;
                if (waveName === "CK") {
                    waveStart = "l.";
                    phase = 0.65;
                } else {
                    wave = chunk.map(o => o.wave || o).join("");
                    phase = 0.15;
                    data = chunk.filter(d => d.data).map(o => o.data).flat();
                    waveStart = "x";

                    if (waveName === "DQ") {
                        // handle data bursts split into separate chunks
                        if (cutOffData) {
                            // insert bit cut off from previous chunk
                            waveStart = "=";
                            data.unshift(cutOffData);
                            cutOffData = null;
                        }

                        if (wave.slice(-1) === "=") {
                            // move last bit to the next chunk
                            cutOffData = data[data.length - 1];
                        }
                    }
                }
                signal.push({ name: waveName, wave: waveStart + wave, data: data, period: 0.5, phase: phase });
            }

            const chunkTicks = ticks.slice(startIndex * 2, endIndex * 2);
            const waveObj = {
                signal: signal,
                head: { tick: ["\u200B " + chunkTicks.map(formatSi).join(" ") + " \u200B"] },
                foot: { tick: ["\u200B " + chunkTicks.map(t => cyclesToTime(t, freqMhz)).join(" ") + " \u200B"] }
            };

            let waveElem = document.createElement("div");
            waveElem.id = "wave" + waveIndex;
            waveElem.classList.add("wave");
            waveContainer.appendChild(waveElem);
            WaveDrom.RenderWaveForm(waveIndex, waveObj, "wave", false);
        }
    }

    update();

    let renderTimeout;
    window.onresize = function() {
        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(render, 200);
    }
})();
