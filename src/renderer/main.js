import * as d3 from 'd3';
import './style.css';

async function fetchCommits() {
  const result = await window.gitopo.git.exec(
    'log --all --format="%H %P %s" --topo-order'
  );

  if (!result.success) {
    console.error('Failed to fetch commits:', result.error);
    return [];
  }

  const commits = [];
  const lines = result.output.trim().split('\n');

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]+)\s*([a-f0-9\s]*?)\s{2,}(.*)$/);
    if (match) {
      const [, hash, parentsStr, message] = match;
      const parents = parentsStr.trim() ? parentsStr.trim().split(' ') : [];
      commits.push({ hash, parents, message });
    }
  }

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
  const svg = d3.select('#graph');
  const width = window.innerWidth;
  const height = window.innerHeight;

  svg.attr('width', width).attr('height', height);

  const nodeRadius = 8;
  const nodeSpacingY = 50;
  const nodeSpacingX = 100;

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

  // Simple layout: each commit gets a row, column based on first-parent chain
  const positions = new Map();
  let maxCol = 0;

  commits.forEach((commit, i) => {
    let col = 0;
    if (commit.parents.length > 0) {
      const parentPos = positions.get(commit.parents[0]);
      if (parentPos) {
        col = parentPos.col;
      }
    }
    // Check for collision
    for (const [, pos] of positions) {
      if (pos.row === i && pos.col === col) {
        col = maxCol + 1;
        break;
      }
    }
    maxCol = Math.max(maxCol, col);
    positions.set(commit.hash, { row: i, col });
  });

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

  svg
    .selectAll('line')
    .data(edges)
    .enter()
    .append('line')
    .attr('x1', (d) => 50 + d.child.col * nodeSpacingX)
    .attr('y1', (d) => 30 + d.child.row * nodeSpacingY)
    .attr('x2', (d) => 50 + d.parent.col * nodeSpacingX)
    .attr('y2', (d) => 30 + d.parent.row * nodeSpacingY)
    .attr('stroke', '#666')
    .attr('stroke-width', 2);

  // Draw nodes
  const nodes = svg
    .selectAll('g.node')
    .data(commits)
    .enter()
    .append('g')
    .attr('class', 'node')
    .attr('transform', (d) => {
      const pos = positions.get(d.hash);
      return `translate(${50 + pos.col * nodeSpacingX}, ${30 + pos.row * nodeSpacingY})`;
    });

  nodes
    .append('circle')
    .attr('r', nodeRadius)
    .attr('fill', (d) => (hashToBranches.has(d.hash) ? '#4fc3f7' : '#fff'))
    .attr('stroke', '#333')
    .attr('stroke-width', 2);

  // Draw labels (commit message)
  nodes
    .append('text')
    .attr('x', 15)
    .attr('y', 5)
    .attr('fill', '#ccc')
    .attr('font-size', '12px')
    .text((d) => {
      const branchNames = hashToBranches.get(d.hash);
      const prefix = branchNames ? `[${branchNames.join(', ')}] ` : '';
      return prefix + d.message.substring(0, 50);
    });
}

async function init() {
  const [commits, branches] = await Promise.all([
    fetchCommits(),
    fetchBranches(),
  ]);

  console.log('Commits:', commits);
  console.log('Branches:', branches);

  renderGraph(commits, branches);
}

init();
