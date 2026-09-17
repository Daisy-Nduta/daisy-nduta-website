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

    /*
     * Every page picks a mood via <body data-bg="...">. No attribute
     * (Home, About, Contact) falls back to "puddles". Each mood is a
     * genuinely different animation, not just a re-tuned variant.
     */
    const preset = document.body.dataset.bg || 'puddles';
    const INK = 'rgba(32, 30, 31,';
    const ACCENT = 'rgba(162, 33, 6,'; // #a22106, the site's highlight color -- used sparingly, only on each animation's most reactive/pointer-linked element

    const WATER_LINES = 46;
    const WATER_POINTS = 200;
    const sources = preset === 'puddles' ? Array.from({ length: 11 }, (_, i) => ({
        seed: i * 812,
        jitterX: Math.sin(i * 12.9) * .06,
        jitterY: Math.cos(i * 7.3) * .06,
        life: 3800 + (i % 5) * 520,
        mouseLinked: i % 2 === 0,
        x: Math.random(),
        y: Math.random()
    })) : null;

    const waveLines = preset === 'sound' ? Array.from({ length: 7 }, (_, i) => ({
        baseline: (i + 1) / 8,
        amplitude: 12 + Math.random() * 10,
        freq: 1.1 + Math.random() * 1.7,
        speed: .0007 + Math.random() * .0006,
        phase: Math.random() * Math.PI * 2,
        opacity: .18 + Math.random() * .16
    })) : null;

    const planets = preset === 'curation' ? [
        { orbit: .18, flatten: .58, angle: 0, speed: .00038, size: 4 },
        { orbit: .29, flatten: .62, angle: 1.1, speed: -.0003, size: 3.2 },
        { orbit: .4, flatten: .5, angle: 2.4, speed: .00024, size: 5.8 },
        { orbit: .51, flatten: .64, angle: 3.6, speed: -.00019, size: 3.6 },
        { orbit: .62, flatten: .46, angle: 5, speed: .00014, size: 5 },
        { orbit: .72, flatten: .56, angle: 2.1, speed: -.00011, size: 3 }
    ] : null;

    const nodes = preset === 'cultural' ? Array.from({ length: 70 }, () => ({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - .5) * .00018,
        vy: (Math.random() - .5) * .00018
    })) : null;

    /*
     * Puddles (default -- Home, About, Contact): one shared water surface,
     * drawn as a stack of horizontal lines. Each ripple source contributes
     * a decaying, expanding wave to every sampled point; overlapping waves
     * simply add together, so two ripples genuinely reinforce or cancel
     * each other rather than existing as independent circles.
     */
    function drawPuddles(time) {
        const reach = Math.min(width, height) * .55;

        const active = sources.map(source => {
            const age = (time + source.seed) % source.life;
            const envelope = Math.sin((age / source.life) * Math.PI);
            return {
                x: (source.mouseLinked ? smoothX + source.jitterX : source.x) * width,
                y: (source.mouseLinked ? smoothY + source.jitterY : source.y) * height,
                age,
                envelope,
                mouseLinked: source.mouseLinked
            };
        });

        for (let line = 0; line < WATER_LINES; line += 1) {
            const baseY = ((line + .5) / WATER_LINES) * height;

            context.beginPath();
            for (let p = 0; p <= WATER_POINTS; p += 1) {
                const x = (p / WATER_POINTS) * width;
                let displacement = 0;

                active.forEach(source => {
                    const dx = x - source.x;
                    const dy = baseY - source.y;
                    const distance = Math.hypot(dx, dy);
                    if (distance > reach) return;

                    const falloff = 1 - distance / reach;
                    displacement += Math.sin(distance * .07 - source.age * .012) * falloff * falloff * source.envelope * 7;
                });

                const y = baseY + displacement;
                if (p === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }

            context.strokeStyle = `${INK} .16)`;
            context.lineWidth = 1;
            context.stroke();
        }
    }

    /* Sound: a stack of flowing waveform lines that swell where the pointer nears them. */
    function drawSound(time) {
        const mouseX = smoothX * width;
        const mouseY = smoothY * height;
        const reach = Math.min(width, height) * .4;
        const points = 200;

        waveLines.forEach((line, index) => {
            const baseY = line.baseline * height;
            const t = time * line.speed + line.phase;

            context.beginPath();
            for (let i = 0; i <= points; i += 1) {
                const nx = i / points;
                const x = nx * width;
                const wave =
                    Math.sin(nx * Math.PI * 2 * line.freq + t) * line.amplitude +
                    Math.sin(nx * Math.PI * 2 * line.freq * 2.3 - t * 1.6) * line.amplitude * .35 +
                    Math.sin(nx * Math.PI * 2 * line.freq * .5 + t * .6) * line.amplitude * .5;

                const dx = x - mouseX;
                const dy = baseY - mouseY;
                const distance = Math.hypot(dx, dy);
                const influence = Math.max(0, 1 - distance / reach);
                const boost = 1 + influence * influence * 3.4;

                const y = baseY + wave * boost;

                if (i === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }

            const isLead = index === 3;
            context.strokeStyle = isLead ? `${ACCENT} ${(line.opacity + .1).toFixed(2)})` : `${INK} ${line.opacity})`;
            context.lineWidth = isLead ? 1.6 : 1.3;
            context.stroke();
        });
    }

    /* Curation & Production: a large orbital system -- planets quicken, glow, and trail as the pointer passes near them. */
    function drawPlanetary() {
        const offsetX = smoothX - .5;
        const offsetY = smoothY - .5;
        const cx = width / 2 + offsetX * width * .18;
        const cy = height / 2 + offsetY * height * .18;
        const base = Math.min(width, height);
        const mouseX = smoothX * width;
        const mouseY = smoothY * height;
        const reach = base * .26;

        planets.forEach(planet => {
            const orbitRX = base * planet.orbit;
            const orbitRY = orbitRX * planet.flatten;

            const px = cx + Math.cos(planet.angle) * orbitRX;
            const py = cy + Math.sin(planet.angle) * orbitRY;
            const distance = Math.hypot(px - mouseX, py - mouseY);
            const influence = Math.max(0, 1 - distance / reach);
            const eased = influence * influence;

            context.beginPath();
            context.ellipse(cx, cy, orbitRX, orbitRY, 0, 0, Math.PI * 2);
            context.strokeStyle = `${INK} ${(.14 + eased * .3).toFixed(2)})`;
            context.lineWidth = 1 + eased * 1.4;
            context.stroke();

            planet.angle += planet.speed * (1 + eased * 9);

            if (eased > .02) {
                for (let echo = 1; echo <= 5; echo += 1) {
                    const echoAngle = planet.angle - planet.speed * (1 + eased * 9) * echo * 2.2;
                    const ex = cx + Math.cos(echoAngle) * orbitRX;
                    const ey = cy + Math.sin(echoAngle) * orbitRY;
                    context.beginPath();
                    context.arc(ex, ey, Math.max(.6, planet.size * (1 - echo / 6)), 0, Math.PI * 2);
                    context.fillStyle = `${ACCENT} ${(eased * .3 * (1 - echo / 6)).toFixed(2)})`;
                    context.fill();
                }

                context.beginPath();
                context.arc(px, py, planet.size + eased * 12, 0, Math.PI * 2);
                context.strokeStyle = `${ACCENT} ${(eased * .5).toFixed(2)})`;
                context.lineWidth = 1;
                context.stroke();
            }

            context.beginPath();
            context.arc(px, py, planet.size + eased * 7, 0, Math.PI * 2);
            context.fillStyle = `${INK} ${(.45 + eased * .45).toFixed(2)})`;
            context.fill();
        });

        context.beginPath();
        context.arc(cx, cy, base * .022 + 4, 0, Math.PI * 2);
        context.strokeStyle = `${ACCENT} .5)`;
        context.lineWidth = 1.4;
        context.stroke();
    }

    /* Cultural Projects: a drifting network, the pointer joins as a node. */
    function drawConstellation() {
        const linkRadius = Math.min(width, height) * .2;
        const mouseNode = { x: smoothX * width, y: smoothY * height };

        nodes.forEach(node => {
            node.x += node.vx;
            node.y += node.vy;
            if (node.x < 0 || node.x > 1) node.vx *= -1;
            if (node.y < 0 || node.y > 1) node.vy *= -1;
        });

        const points = nodes.map(node => ({ x: node.x * width, y: node.y * height }));
        points.push(mouseNode);

        for (let i = 0; i < points.length; i += 1) {
            for (let j = i + 1; j < points.length; j += 1) {
                const dx = points[i].x - points[j].x;
                const dy = points[i].y - points[j].y;
                const distance = Math.hypot(dx, dy);

                if (distance < linkRadius) {
                    const isMouseLink = i === points.length - 1 || j === points.length - 1;
                    context.beginPath();
                    context.moveTo(points[i].x, points[i].y);
                    context.lineTo(points[j].x, points[j].y);
                    const opacity = (1 - distance / linkRadius) * (isMouseLink ? .6 : .34);
                    context.strokeStyle = isMouseLink ? `${ACCENT} ${opacity.toFixed(2)})` : `${INK} ${opacity.toFixed(2)})`;
                    context.lineWidth = isMouseLink ? 1.2 : .9;
                    context.stroke();
                }
            }
        }

        points.forEach((point, index) => {
            const isMouseNode = index === points.length - 1;
            context.beginPath();
            context.arc(point.x, point.y, isMouseNode ? 3.4 : 1.8, 0, Math.PI * 2);
            context.fillStyle = isMouseNode ? `${ACCENT} .6)` : `${INK} .38)`;
            context.fill();
        });
    }

    function draw(time) {
        context.clearRect(0, 0, width, height);
        smoothX += (pointerX - smoothX) * .035;
        smoothY += (pointerY - smoothY) * .035;

        if (preset === 'sound') drawSound(time);
        else if (preset === 'curation') drawPlanetary();
        else if (preset === 'cultural') drawConstellation();
        else drawPuddles(time);

        requestAnimationFrame(draw);
    }

    resize();
    requestAnimationFrame(draw);
})();

/*
 * Home's entry cards auto-rotate through a single focal position instead of
 * sitting in a static grid (client-requested). No-ops on every other page,
 * since .entry-carousel only exists on index.html.
 */
(() => {
    const carousel = document.querySelector('.entry-carousel');
    if (!carousel) return;

    const track = carousel.querySelector('.entry-carousel__track');
    const cards = Array.from(track.querySelectorAll('.entry-card'));
    const dots = Array.from(carousel.querySelectorAll('.entry-carousel__dot'));
    const prevBtn = carousel.querySelector('.entry-carousel__arrow--prev');
    const nextBtn = carousel.querySelector('.entry-carousel__arrow--next');
    const total = cards.length;
    if (total < 2) return;

    const AUTOPLAY_MS = 4500;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let active = 0;
    let timer = null;

    function render() {
        cards.forEach((card, i) => {
            let delta = i - active;
            if (delta > total / 2) delta -= total;
            if (delta < -total / 2) delta += total;

            const abs = Math.abs(delta);
            const scale = abs === 0 ? 1 : abs === 1 ? .82 : .68;
            const opacity = abs === 0 ? 1 : abs === 1 ? .65 : .3;

            card.style.transform = `translate(calc(-50% + ${delta * 58}%), 0) scale(${scale})`;
            card.style.opacity = String(opacity);
            card.style.zIndex = String(10 - abs);
            card.setAttribute('aria-hidden', abs === 0 ? 'false' : 'true');
            card.tabIndex = abs === 0 ? 0 : -1;
        });
        dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === active)));
    }

    function goTo(index) {
        active = ((index % total) + total) % total;
        render();
    }

    function next() { goTo(active + 1); }
    function prev() { goTo(active - 1); }

    function stopAutoplay() {
        if (timer) clearInterval(timer);
        timer = null;
    }
    function startAutoplay() {
        if (reduceMotion) return;
        stopAutoplay();
        timer = setInterval(next, AUTOPLAY_MS);
    }

    prevBtn.addEventListener('click', () => { prev(); startAutoplay(); });
    nextBtn.addEventListener('click', () => { next(); startAutoplay(); });
    dots.forEach((dot, i) => dot.addEventListener('click', () => { goTo(i); startAutoplay(); }));

    // A peeking (non-active) card brings itself into focus on click rather
    // than navigating away immediately -- only the centered card's link
    // actually leaves the page.
    cards.forEach((card, i) => {
        card.addEventListener('click', event => {
            if (i !== active) {
                event.preventDefault();
                goTo(i);
                startAutoplay();
            }
        });
    });

    carousel.addEventListener('mouseenter', stopAutoplay);
    carousel.addEventListener('mouseleave', startAutoplay);
    carousel.addEventListener('focusin', stopAutoplay);
    carousel.addEventListener('focusout', startAutoplay);

    render();
    startAutoplay();
})();
