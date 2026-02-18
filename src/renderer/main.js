import * as d3 from 'd3';
import './style.css';

let allCommits = [];
let allBranches = [];
let hashToCommit = new Map();

async function fetchCommits() {
  const result = await window.gitopo.git.exec(
    'log --all --format="%H|%P|%ct|%s" --date-order -1000'
  );

  if (!result.success) {
    console.error('Failed to fetch commits:', result.error);
    return [];
  }

  const commits = [];
  const lines = result.output.trim().split('\n');

  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length >= 4) {
      const hash = parts[0];
      const parentsStr = parts[1];
      const timestamp = parseInt(parts[2], 10);
      const message = parts.slice(3).join('|');
      const parents = parentsStr.trim() ? parentsStr.trim().split(' ') : [];
      commits.push({ hash, parents, timestamp, message });
    }
  }

  commits.sort((a, b) => b.timestamp - a.timestamp);
  return commits;
}

async function fetchBranches() {
  const result = await window.gitopo.git.exec(
    'branch -a --format="%(refname:short) %(objectname)"'
  );

  if (!result.success) {
    console.error('Failed to fetch branches:', result.error);
    return [];
  }

  const branches = [];
  const lines = result.output.trim().split('\n');

  for (const line of lines) {
    const parts = line.trim().split(' ');
    if (parts.length >= 2) {
      const name = parts[0];
      const hash = parts[1];
      branches.push({ name, hash });
    }
  }

  return branches;
}

function populateBranchSelectors(branches) {
  const selectors = ['branch1', 'branch2', 'branch3'];
  const defaultBranch = branches.find(
    (b) => b.name === 'main' || b.name === 'master'
  );

  selectors.forEach((id, index) => {
    const select = document.getElementById(id);
    select.innerHTML = '';

    // Add empty option
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '----';
    select.appendChild(emptyOption);

    // Add branch options
    branches.forEach((branch) => {
      const option = document.createElement('option');
      option.value = branch.name;
      option.textContent = branch.name;
      select.appendChild(option);
    });

    // Set default for first selector
    if (index === 0 && defaultBranch) {
      select.value = defaultBranch.name;
    }

    select.addEventListener('change', () => renderGraph());
  });
}

function getFirstParentLineage(branchName) {
  const branch = allBranches.find((b) => b.name === branchName);
  if (!branch) return new Set();

  const lineage = new Set();
  let currentHash = branch.hash;

  while (currentHash) {
    lineage.add(currentHash);
    const commit = hashToCommit.get(currentHash);
    if (commit && commit.parents.length > 0) {
      currentHash = commit.parents[0]; // First parent only
    } else {
      break;
    }
  }

  return lineage;
}

function getSelectedBranches() {
  const branches = [];
  ['branch1', 'branch2', 'branch3'].forEach((id) => {
    const select = document.getElementById(id);
    if (select && select.value) {
      branches.push(select.value);
    }
  });
  return branches;
}

function renderGraph() {
  const svg = d3.select('#graph');
  svg.selectAll('*').remove();

  const container = d3.select('#app');
  container.selectAll('.tooltip').remove();

  const controlsHeight = document.getElementById('controls').offsetHeight;
  const width = window.innerWidth;
  const height = window.innerHeight - controlsHeight;

  svg.attr('width', width).attr('height', height);

  const nodeRadius = 6;
  const nodeSpacingY = 30;
  const columnWidth = 150;
  const paddingTop = 50;
  const paddingLeft = 50;

  const selectedBranches = getSelectedBranches();

  // Calculate lineage for each selected branch
  const branchLineages = selectedBranches.map((name) => ({
    name,
    lineage: getFirstParentLineage(name),
  }));

  // Build hash -> branch map
  const hashToBranches = new Map();
  allBranches.forEach((b) => {
    if (!hashToBranches.has(b.hash)) {
      hashToBranches.set(b.hash, []);
    }
    hashToBranches.get(b.hash).push(b.name);
  });

  // Assign commits to columns
  const commitColumn = new Map();

  allCommits.forEach((commit) => {
    let assignedColumn = -1;

    // Check if commit belongs to any selected branch lineage
    for (let i = 0; i < branchLineages.length; i++) {
      if (branchLineages[i].lineage.has(commit.hash)) {
        assignedColumn = i;
        break;
      }
    }

    // If not in any lineage, put in "Other" column
    if (assignedColumn === -1) {
      assignedColumn = branchLineages.length;
    }

    commitColumn.set(commit.hash, assignedColumn);
  });

  // Calculate positions - all commits share the same row space (by global index)
  const positions = new Map();

  allCommits.forEach((commit, globalIndex) => {
    const col = commitColumn.get(commit.hash);
    positions.set(commit.hash, {
      col: col,
      row: globalIndex,
      x: paddingLeft + col * columnWidth,
      y: paddingTop + globalIndex * nodeSpacingY,
    });
  });

  // Calculate content height
  const contentHeight = allCommits.length * nodeSpacingY + paddingTop * 2;

  // Check if "Other" column has commits
  const hasOtherCommits = Array.from(commitColumn.values()).some(
    (col) => col === branchLineages.length
  );

  // Create main group for zoom/pan
  const mainGroup = svg.append('g').attr('class', 'main-group');

  // Create tooltip
  const tooltip = container
    .append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);

  // Draw column headers
  branchLineages.forEach((branch, index) => {
    mainGroup
      .append('text')
      .attr('x', paddingLeft + index * columnWidth)
      .attr('y', 25)
      .attr('fill', '#4fc3f7')
      .attr('font-size', '14px')
      .attr('font-weight', 'bold')
      .text(branch.name);
  });

  // "Other" column header
  if (hasOtherCommits) {
    mainGroup
      .append('text')
      .attr('x', paddingLeft + branchLineages.length * columnWidth)
      .attr('y', 25)
      .attr('fill', '#888')
      .attr('font-size', '14px')
      .text('Other');
  }

  // Draw edges
  allCommits.forEach((commit) => {
    const childPos = positions.get(commit.hash);
    if (!childPos) return;

    commit.parents.forEach((parentHash) => {
      const parentPos = positions.get(parentHash);
      if (parentPos) {
        mainGroup
          .append('line')
          .attr('x1', childPos.x)
          .attr('y1', childPos.y)
          .attr('x2', parentPos.x)
          .attr('y2', parentPos.y)
          .attr('stroke', '#666')
          .attr('stroke-width', 1.5)
          .attr('stroke-opacity', 0.6);
      }
    });
  });

  // Draw nodes
  const nodes = mainGroup
    .selectAll('g.node')
    .data(allCommits)
    .enter()
    .append('g')
    .attr('class', 'node')
    .attr('transform', (d) => {
      const pos = positions.get(d.hash);
      return pos ? `translate(${pos.x}, ${pos.y})` : 'translate(-100, -100)';
    });

  nodes
    .append('circle')
    .attr('r', (d) => {
      const col = commitColumn.get(d.hash);
      return col < branchLineages.length ? nodeRadius : nodeRadius * 0.7;
    })
    .attr('fill', (d) => {
      const col = commitColumn.get(d.hash);
      if (col < branchLineages.length) {
        return hashToBranches.has(d.hash) ? '#4fc3f7' : '#fff';
      }
      return '#888';
    })
    .attr('stroke', '#333')
    .attr('stroke-width', (d) => {
      const col = commitColumn.get(d.hash);
      return col < branchLineages.length ? 2 : 1;
    })
    .style('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      const branchNames = hashToBranches.get(d.hash);
      const branchInfo = branchNames ? `[${branchNames.join(', ')}]<br/>` : '';
      const date = new Date(d.timestamp * 1000).toLocaleString();

      tooltip
        .html(
          `<strong>${d.hash.substring(0, 7)}</strong><br/>` +
            `${branchInfo}${d.message}<br/>` +
            `<span class="date">${date}</span>`
        )
        .style('left', event.pageX + 15 + 'px')
        .style('top', event.pageY - 10 + 'px')
        .style('opacity', 1);
    })
    .on('mousemove', (event) => {
      tooltip
        .style('left', event.pageX + 15 + 'px')
        .style('top', event.pageY - 10 + 'px');
    })
    .on('mouseleave', () => {
      tooltip.style('opacity', 0);
    });

  // Zoom and pan behavior
  const zoom = d3
    .zoom()
    .scaleExtent([0.1, 3])
    .on('zoom', (event) => {
      mainGroup.attr('transform', event.transform);
    });

  zoom.filter((event) => {
    if (event.type === 'wheel') return true;
    if (event.touches) return true;
    if (event.type === 'mousedown' && event.button === 2) return true;
    if (event.type === 'mousemove' && event.buttons === 2) return true;
    if (event.type === 'mousedown' && event.button === 0) return false;
    return true;
  });

  svg.call(zoom);

  svg.on('contextmenu', (event) => {
    event.preventDefault();
  });
}

async function init() {
  [allCommits, allBranches] = await Promise.all([
    fetchCommits(),
    fetchBranches(),
  ]);

  // Build hash -> commit map
  hashToCommit.clear();
  allCommits.forEach((c) => hashToCommit.set(c.hash, c));

  console.log('Commits:', allCommits.length);
  console.log('Branches:', allBranches.length);

  populateBranchSelectors(allBranches);
  renderGraph();

  window.addEventListener('resize', () => {
    renderGraph();
  });
}

init();
