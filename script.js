(() => {
    const canvas = document.createElement('canvas');
    canvas.id = 'topographic';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);

    const context = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    let ratio = 1;
    let pointerX = .5;
    let pointerY = .5;
    let smoothX = .5;
    let smoothY = .5;
    const terrainFeatures = Array.from({ length: 6 }, () => ({
        x: .1 + Math.random() * .8,
        y: .14 + Math.random() * .72,
        radiusX: .12 + Math.random() * .13,
        radiusY: .12 + Math.random() * .16,
        amplitude: (Math.random() > .5 ? 1 : -1) * (20 + Math.random() * 22),
        speed: .35 + Math.random() * .55,
        offset: Math.random() * Math.PI * 2
    }));

    function resize() {
        ratio = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    window.addEventListener('resize', resize);
    function updatePointer(x, y) {
        pointerX = x / width;
        pointerY = y / height;
    }

    window.addEventListener('pointerdown', event => {
        updatePointer(event.clientX, event.clientY);
    });
    window.addEventListener('pointermove', event => {
        updatePointer(event.clientX, event.clientY);
    });
    window.addEventListener('touchstart', event => {
        const touch = event.touches[0];
        if (touch) updatePointer(touch.clientX, touch.clientY);
    }, { passive: true });
    window.addEventListener('touchmove', event => {
        const touch = event.touches[0];
        if (touch) updatePointer(touch.clientX, touch.clientY);
    }, { passive: true });

    function draw(time) {
        context.clearRect(0, 0, width, height);
        smoothX += (pointerX - smoothX) * .035;
        smoothY += (pointerY - smoothY) * .035;

        const lines = Math.max(180, Math.floor(width / 8));
        const points = 110;
        const spacing = width / (lines - 1);
        const phase = time * .00018;
        const terrainTime = time * .0001;
        const mouseX = smoothX * width;
        const mouseY = smoothY * height;
        const radius = Math.min(width, height) * .38;

        context.strokeStyle = 'rgba(32, 30, 31, .22)';
        context.lineWidth = .65;

        for (let line = 0; line < lines; line += 1) {
            const baseX = line * spacing;
            context.beginPath();

            for (let point = 0; point <= points; point += 1) {
                const normalizedY = point / points;
                const y = normalizedY * height;
                const wave =
                    Math.sin(normalizedY * Math.PI * 2.3 + phase) * 18 +
                    Math.sin(normalizedY * Math.PI * 5.1 - phase * .7) * 10;
                const dx = baseX - mouseX;
                const dy = y - mouseY;
                const distance = Math.hypot(dx, dy);
                const influence = Math.max(0, 1 - distance / radius);
                const smoothInfluence = influence * influence * (3 - 2 * influence);
                const push = (mouseX - baseX) * .06 * smoothInfluence;
                const mouseWave = Math.sin(normalizedY * Math.PI * 2 + smoothX * 5) * 14 * smoothInfluence;
                let terrain = 0;

                terrainFeatures.forEach(feature => {
                    const featureX = feature.x + Math.sin(terrainTime * feature.speed + feature.offset) * .035;
                    const featureY = feature.y + Math.cos(terrainTime * feature.speed * .8 + feature.offset) * .025;
                    const fieldX = (baseX / width - featureX) / feature.radiusX;
                    const fieldY = (normalizedY - featureY) / feature.radiusY;
                    const fieldDistance = Math.hypot(fieldX, fieldY);
                    const falloff = Math.exp(-fieldDistance * fieldDistance * 1.8);
                    terrain += Math.sin(fieldDistance * 16) * falloff * feature.amplitude;
                });

                const x = baseX + wave + terrain + push + mouseWave;

                if (point === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }

            context.stroke();
        }

        requestAnimationFrame(draw);
    }

    resize();
    requestAnimationFrame(draw);
})();
