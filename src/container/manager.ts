import Docker from 'dockerode';

const docker = new Docker();

const IMAGE_NAME = 'claude-code-assistant';

export interface ContainerInfo {
  name: string;
  state: string;
  running: boolean;
}

export async function buildImage(dockerfilePath: string): Promise<void> {
  const stream = await docker.buildImage(
    { context: dockerfilePath, src: ['Dockerfile'] },
    { t: IMAGE_NAME }
  );
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function createContainer(
  projectName: string,
  claudeHome: string
): Promise<{ containerName: string; volumeName: string }> {
  const containerName = `claude-project-${projectName}`;
  const volumeName = `claude-vol-${projectName}`;

  // Create volume if it doesn't exist
  try {
    await docker.getVolume(volumeName).inspect();
  } catch {
    await docker.createVolume({ Name: volumeName });
  }

  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name: containerName,
    Tty: false,
    OpenStdin: true,
    StdinOnce: false,
    Cmd: ['/bin/bash', '-c', 'sleep infinity'],
    WorkingDir: '/workspace',
    HostConfig: {
      Binds: [
        `${volumeName}:/workspace`,
        `${claudeHome}:/home/user/.claude:ro`,
      ],
      RestartPolicy: { Name: 'unless-stopped' },
    },
  });

  await container.start();
  return { containerName, volumeName };
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

export async function imageExists(): Promise<boolean> {
  try {
    await docker.getImage(IMAGE_NAME).inspect();
    return true;
  } catch {
    return false;
  }
}
