import * as d3 from 'd3';
import './style.css';

async function fetchCommits() {
  // Fetch 1000 commits with date, sorted by date
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

  // Sort by timestamp (newest first)
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
    const [name, hash] = line.trim().split(' ');
    if (name && hash) {
      branches.push({ name, hash });
    }
  }

  return branches;
}

function renderGraph(commits, branches) {
  const container = d3.select('#app');
  const svg = d3.select('#graph');
  const width = window.innerWidth;
  const height = window.innerHeight;

  svg.attr('width', width).attr('height', height);

  const nodeRadius = 6;
  const nodeSpacingY = 30;
  const nodeSpacingX = 80;
  const paddingTop = 50;
  const paddingLeft = 50;

  // Build hash -> index map
  const hashToIndex = new Map();
  commits.forEach((c, i) => hashToIndex.set(c.hash, i));

  // Build hash -> branch map
  const hashToBranches = new Map();
  branches.forEach((b) => {
    if (!hashToBranches.has(b.hash)) {
      hashToBranches.set(b.hash, []);
    }
    hashToBranches.get(b.hash).push(b.name);
  });

  // Layout: assign columns based on first-parent chain
  const positions = new Map();
  const colUsedAtRow = new Map();

  commits.forEach((commit, row) => {
    let col = 0;

    if (commit.parents.length > 0) {
      const parentPos = positions.get(commit.parents[0]);
      if (parentPos) {
        col = parentPos.col;
      }
    }

    // Check collision at this row
    const usedCols = colUsedAtRow.get(row) || new Set();
    while (usedCols.has(col)) {
      col++;
    }
    usedCols.add(col);
    colUsedAtRow.set(row, usedCols);

    positions.set(commit.hash, { row, col });
  });

  // Calculate content dimensions
  const maxCol = Math.max(...Array.from(positions.values()).map((p) => p.col));
  const contentHeight = commits.length * nodeSpacingY + paddingTop * 2;
  const contentWidth = (maxCol + 1) * nodeSpacingX + paddingLeft * 2;

  // Create main group for zoom/pan
  const mainGroup = svg.append('g').attr('class', 'main-group');

  // Create tooltip
  const tooltip = container
    .append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);

  // Draw edges
  const edges = [];
  commits.forEach((commit) => {
    const childPos = positions.get(commit.hash);
    commit.parents.forEach((parentHash) => {
      const parentPos = positions.get(parentHash);
      if (childPos && parentPos) {
        edges.push({ child: childPos, parent: parentPos });
      }
    });
  });

  mainGroup
    .selectAll('line')
    .data(edges)
    .enter()
    .append('line')
    .attr('x1', (d) => paddingLeft + d.child.col * nodeSpacingX)
    .attr('y1', (d) => paddingTop + d.child.row * nodeSpacingY)
    .attr('x2', (d) => paddingLeft + d.parent.col * nodeSpacingX)
    .attr('y2', (d) => paddingTop + d.parent.row * nodeSpacingY)
    .attr('stroke', '#666')
    .attr('stroke-width', 2);

  // Draw nodes
  const nodes = mainGroup
    .selectAll('g.node')
    .data(commits)
    .enter()
    .append('g')
    .attr('class', 'node')
    .attr('transform', (d) => {
      const pos = positions.get(d.hash);
      return `translate(${paddingLeft + pos.col * nodeSpacingX}, ${paddingTop + pos.row * nodeSpacingY})`;
    });

  nodes
    .append('circle')
    .attr('r', nodeRadius)
    .attr('fill', (d) => (hashToBranches.has(d.hash) ? '#4fc3f7' : '#fff'))
    .attr('stroke', '#333')
    .attr('stroke-width', 2)
    .style('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      const branchNames = hashToBranches.get(d.hash);
      const branchInfo = branchNames ? `[${branchNames.join(', ')}]\n` : '';
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
  let currentTransform = d3.zoomIdentity;

  const zoom = d3
    .zoom()
    .scaleExtent([0.1, 3])
    .on('zoom', (event) => {
      currentTransform = event.transform;
      mainGroup.attr('transform', event.transform);
    });

  // Custom filter: allow wheel, touch, and right-button drag
  zoom.filter((event) => {
    // Allow wheel events
    if (event.type === 'wheel') return true;
    // Allow touch events
    if (event.touches) return true;
    // Allow right-button drag (button === 2)
    if (event.type === 'mousedown' && event.button === 2) return true;
    if (event.type === 'mousemove' && event.buttons === 2) return true;
    // Block left-button drag by default
    if (event.type === 'mousedown' && event.button === 0) return false;
    return true;
  });

  svg.call(zoom);

  // Prevent context menu on right-click
  svg.on('contextmenu', (event) => {
    event.preventDefault();
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    svg.attr('width', window.innerWidth).attr('height', window.innerHeight);
  });
}

async function init() {
  const [commits, branches] = await Promise.all([
    fetchCommits(),
    fetchBranches(),
  ]);

  console.log('Commits:', commits.length);
  console.log('Branches:', branches.length);

  renderGraph(commits, branches);
}

init();
