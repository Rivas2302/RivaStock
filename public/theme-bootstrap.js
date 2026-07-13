try {
  var appTheme = localStorage.getItem('theme');
  document.documentElement.classList.toggle('dark', appTheme === 'dark');
  document.documentElement.classList.toggle('light', appTheme !== 'dark');
} catch (_) {
  document.documentElement.classList.add('light');
}
