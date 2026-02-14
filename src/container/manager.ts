import Docker from 'dockerode';

const docker = new Docker();

const IMAGE_NAME = 'claude-code-assistant';

export interface ContainerInfo {
  name: string;
  state: string;
  running: boolean;
}

export async function buildImage(): Promise<void> {
  const stream = await docker.buildImage(
    { context: '.', src: ['Dockerfile.project'] },
    { t: IMAGE_NAME, dockerfile: 'Dockerfile.project' }
  );
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export interface ContainerOptions {
  claudeHome: string;
  sshPath?: string;
  gitconfigPath?: string;
  ghToken?: string;
  claudeMdPath?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  envVars?: Record<string, string>;
}

export async function createContainer(
  projectName: string,
  mounts: ContainerOptions
): Promise<{ containerName: string; volumeName: string }> {
  const containerName = `claude-project-${projectName}`;
  const volumeName = `claude-vol-${projectName}`;

  // Create volume if it doesn't exist
  try {
    await docker.getVolume(volumeName).inspect();
  } catch {
    await docker.createVolume({ Name: volumeName });
  }

  const binds = [
    `${volumeName}:/workspace`,
    `${mounts.claudeHome}:/home/user/.claude`,
  ];

  // Mount SSH keys to a staging dir (Windows mounts have 777 permissions,
  // which SSH rejects). We copy + fix permissions on container start.
  if (mounts.sshPath) {
    binds.push(`${mounts.sshPath}:/home/user/.ssh-mount:ro`);
  }

  if (mounts.gitconfigPath) {
    binds.push(`${mounts.gitconfigPath}:/home/user/.gitconfig:ro`);
  }

  // Mount CLAUDE.md parent dir to staging location.
  // Windows Docker mounts single files as directories, so we mount the parent dir instead.
  let claudeMdFileName = '';
  if (mounts.claudeMdPath) {
    const lastSep = Math.max(mounts.claudeMdPath.lastIndexOf('/'), mounts.claudeMdPath.lastIndexOf('\\'));
    const claudeMdDir = mounts.claudeMdPath.substring(0, lastSep);
    claudeMdFileName = mounts.claudeMdPath.substring(lastSep + 1);
    binds.push(`${claudeMdDir}:/home/user/.claude-md-mount:ro`);
  }

  // Build startup script that fixes permissions then sleeps
  const startupParts = [
    'sudo chown user:user /workspace',
  ];
  if (mounts.sshPath) {
    startupParts.push(
      'cp -r /home/user/.ssh-mount /home/user/.ssh',
      'chmod 700 /home/user/.ssh',
      'chmod 600 /home/user/.ssh/id_* 2>/dev/null || true',
      'chmod 644 /home/user/.ssh/*.pub 2>/dev/null || true',
      'chmod 644 /home/user/.ssh/known_hosts 2>/dev/null || true',
      'chown -R user:user /home/user/.ssh',
    );
  }
  // Configure git identity
  if (mounts.gitUserName) {
    startupParts.push(`git config --global user.name "${mounts.gitUserName}"`);
  }
  if (mounts.gitUserEmail) {
    startupParts.push(`git config --global user.email "${mounts.gitUserEmail}"`);
  }

  // Configure git credential helper for GH_TOKEN if provided
  if (mounts.ghToken) {
    startupParts.push(
      'git config --global credential.helper store',
      `echo "https://x-access-token:${mounts.ghToken}@github.com" > /home/user/.git-credentials`,
      'chmod 600 /home/user/.git-credentials',
    );
  }

  // Copy CLAUDE.md into workspace if mounted
  if (mounts.claudeMdPath) {
    startupParts.push(`cp /home/user/.claude-md-mount/${claudeMdFileName} /workspace/CLAUDE.md`);
  }

  startupParts.push('exec sleep infinity');
  const startupCmd = startupParts.join(' && ');

  // Pass GH_TOKEN as env var so `gh` CLI and other tools can use it
  const env: string[] = [];
  if (mounts.ghToken) {
    env.push(`GH_TOKEN=${mounts.ghToken}`);
    env.push(`GITHUB_TOKEN=${mounts.ghToken}`);
  }

  // Add project-specific env vars
  if (mounts.envVars) {
    for (const [key, value] of Object.entries(mounts.envVars)) {
      env.push(`${key}=${value}`);
    }
  }

  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name: containerName,
    Tty: false,
    OpenStdin: true,
    StdinOnce: false,
    Cmd: ['/bin/bash', '-c', startupCmd],
    WorkingDir: '/workspace',
    Env: env.length > 0 ? env : undefined,
    HostConfig: {
      Binds: binds,
      RestartPolicy: { Name: 'unless-stopped' },
    },
  });

  await container.start();
  return { containerName, volumeName };
}

export async function recreateContainer(
  projectName: string,
  mounts: ContainerOptions
): Promise<{ containerName: string; volumeName: string }> {
  const containerName = `claude-project-${projectName}`;

  // Stop and remove existing container (keep volume)
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    if (info.State.Running) {
      await container.stop();
    }
    await container.remove();
  } catch {
    // Container may already be gone
  }

  return createContainer(projectName, mounts);
}

export async function removeContainer(containerName: string, volumeName: string): Promise<void> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    if (info.State.Running) {
      await container.stop();
    }
    await container.remove();
  } catch {
    // Container may already be gone
  }

  try {
    await docker.getVolume(volumeName).remove();
  } catch {
    // Volume may already be gone
  }
}

export async function getContainerStatus(containerName: string): Promise<ContainerInfo | null> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    return {
      name: containerName,
      state: info.State.Status,
      running: info.State.Running,
    };
  } catch {
    return null;
  }
}

export async function ensureContainerRunning(containerName: string): Promise<boolean> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    if (!info.State.Running) {
      await container.start();
    }
    return true;
  } catch {
    return false;
  }
}

export async function execInContainer(
  containerName: string,
  cmd: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const container = docker.getContainer(containerName);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: false,
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    docker.modem.demuxStream(stream, {
      write: (chunk: Buffer) => stdoutChunks.push(chunk),
    } as unknown as NodeJS.WritableStream, {
      write: (chunk: Buffer) => stderrChunks.push(chunk),
    } as unknown as NodeJS.WritableStream);

    stream.on('end', async () => {
      const inspectData = await exec.inspect();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
        exitCode: inspectData.ExitCode ?? 1,
      });
    });

    stream.on('error', reject);
  });
}

export async function writeFileToContainer(
  containerName: string,
  destPath: string,
  content: Buffer
): Promise<void> {
  const container = docker.getContainer(containerName);
  const dir = destPath.substring(0, destPath.lastIndexOf('/'));

  // Ensure destination directory exists
  const mkdirExec = await container.exec({
    Cmd: ['mkdir', '-p', dir],
    AttachStdout: true,
    AttachStderr: true,
  });
  const mkdirStream = await mkdirExec.start({ hijack: true, stdin: false });
  await new Promise<void>((resolve) => mkdirStream.on('end', resolve));

  // Write file via stdin -> cat > file
  const writeExec = await container.exec({
    Cmd: ['bash', '-c', `cat > '${destPath}'`],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
  });
  const writeStream = await writeExec.start({ hijack: true, stdin: true });
  writeStream.write(content);
  writeStream.end();
  await new Promise<void>((resolve) => writeStream.on('end', resolve));
}

export async function imageExists(): Promise<boolean> {
  try {
    await docker.getImage(IMAGE_NAME).inspect();
    return true;
  } catch {
    return false;
  }
}
