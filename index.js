(() => {
    const casCommands = ["RD", "RDA", "WR", "WRA"];

    window.update = function update() {
        const freqMhz = +clockFreq.value;
        // map timing names to times, e.g. {CL:14,tRCD:16,...}
        const timings = [].reduce.call(
            document.getElementsByClassName("timing"),
            (o, e) => (o[e.name] = +e.value, o),
            {});

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

        let counter = 0;

        function emitCommand(cmd, args = {}) {
            if (casCommands.includes(cmd)) {
                deferredData.push(
                    { offset: 0, ck: counter + timings.CL },
                    { offset: 2, ck: counter + timings.CL + 1 },
                    { offset: 4, ck: counter + timings.CL + 2 },
                    { offset: 6, ck: counter + timings.CL + 3 });
            }

            ticks.push(counter);
            times.push((counter * 1000 / freqMhz).toFixed(1) + "ns");
            waves.CK.wave.push(".1.0");
            waves.Command.data.push(cmd);
            if (cmd === "DES" && args.warp) {
                ticks.push("\u21DD");
                times.push("\u21DD");
                waves.Command.wave.push("=.x|");
                waves.DQ.wave.push(".x.|");
                if (nextDataCk === counter) {
                    console.error(`Warp during data burst! (time ${counter})`);
                }
            } else {
                ticks.push("\u200B");
                times.push("\u200B");
                waves.Command.wave.push(cmd === "DES" ? "=.x." : "5.x.");
                if (nextDataCk === counter) {
                    waves.DQ.wave.push(".=.=");
                    waves.DQ.data.push("D" + nextData.offset, "D" + (nextData.offset + 1));
                    shiftData();
                } else {
                    waves.DQ.wave.push(".x..");
                }
            }

            if (nextData && nextDataCk <= counter) {
                console.error(`Data burst overlap! (time ${nextDataCk} to ${counter + 1})`);
                while (nextDataCk <= counter) {
                    shiftData();
                }
            }
            if (args.counter)
                counter = args.counter;
            else
                counter++;
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
                const finalDes = counter + time - 2; // generate (time - 1) DES commands
                while (counter < finalDes) {
                    let waitLeft = finalDes - counter;
                    if (waitLeft < 2) {
                        // short wait, skip warp
                        while (counter < finalDes) {
                            emitCommand("DES");
                        }
                    } else if (!nextData) {
                        // no upcoming data, easy warp
                        emitCommand("DES", { warp: true, counter: finalDes });
                    } else {
                        // upcoming data
                        let minWarp = counter + 2;
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
    }

    update();
})();
