async function init() {
  const output = document.getElementById('output');

  // Demo: execute git log
  const result = await window.gitopo.git.exec('log --oneline --graph --all -20');

  if (result.success) {
    output.textContent = result.output;
  } else {
    output.textContent = 'Error: ' + result.error;
  }
}

init();
