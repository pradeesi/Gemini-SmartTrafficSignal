// static/js/theme.js
(function() {
    const themeToggle = document.getElementById('theme-toggle');
    const currentTheme = localStorage.getItem('theme') || 'dark'; // Default to dark

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        // Update icon visibility (optional)
        if (themeToggle) {
            const sunIcon = themeToggle.querySelector('.fa-sun');
            const moonIcon = themeToggle.querySelector('.fa-moon');
            if (sunIcon && moonIcon) {
                sunIcon.style.display = theme === 'dark' ? 'inline-block' : 'none';
                moonIcon.style.display = theme === 'light' ? 'inline-block' : 'none';
            }
        }
    }

    // Set initial theme
    setTheme(currentTheme);

    // Add event listener for the toggle button
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            setTheme(newTheme);
        });
    } else {
        console.warn("Theme toggle button not found.");
    }

})(); // IIFE