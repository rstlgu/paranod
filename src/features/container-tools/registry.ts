import type {
  TransformResult,
  TransformInput,
  OSINTEntity,
  OSINTEdge
} from '@/features/plugins/types';

export interface ContainerToolDefinition {
  id: string;
  name: string;
  description: string;
  image: string;
  /**
   * Build the command to run inside the container.
   * Return a full argv array (e.g. ['maigret', 'username', '--json']).
   */
  buildCommand: (args: { input: TransformInput }) => string[];
  /**
   * Convert stdout/stderr to a TransformResult (entities/edges).
   */
  parseOutput: (args: {
    input: TransformInput;
    exitCode: number | null;
    output: string;
  }) => TransformResult;
  supportsInput: (entity: TransformInput['entity']) => boolean;
}

function tid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function makeEntity(
  source: string,
  type: OSINTEntity['type'],
  value: string,
  label: string,
  metadata: Record<string, unknown> = {}
): OSINTEntity {
  return {
    id: tid(`ct-${source}`),
    type,
    value,
    label,
    metadata: { toolId: source, ...metadata },
    source,
    verified: true,
    timestamp: new Date().toISOString()
  };
}

function makeEdge(
  sourceId: string,
  targetId: string,
  label: string,
  relationship: OSINTEdge['relationship'] = 'associated_with'
): OSINTEdge {
  return { id: tid('ct-edge'), sourceId, targetId, label, relationship };
}

/** True se la URL punta a un'immagine (estensione o host/percorso avatar noto). */
function isImageUrl(url: string): boolean {
  return (
    /\.(jpe?g|png|gif|webp|bmp|svg|ico)(\?|#|$)/i.test(url) ||
    /(gravatar\.com\/avatar|\/avatar[s]?\/|profile_images|pbs\.twimg\.com\/profile|avatars\.githubusercontent)/i.test(
      url
    )
  );
}

/** Parser comune per Sherlock/Maigret: JSON se disponibile, altrimenti URL nel testo. */
function parseAccountsOutput(args: {
  toolId: string;
  input: TransformInput;
  exitCode: number | null;
  output: string;
  toolLabel: string;
}): TransformResult {
  const { toolId, input, exitCode, toolLabel } = args;
  // Normalizza: rimuove sequenze ANSI e i ritorni carrello della progress bar
  // (maigret/sherlock sovrascrivono la riga con \r) → una riga pulita per match.
  const output = args.output
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '\n');
  const username = String(input.entity.value);
  const sourceId = input.entity.id;
  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const seen = new Set<string>();

  const hostOf = (u: string): string => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  };
  const addAccount = (url: string, siteName?: string) => {
    const clean = url.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    const site = siteName?.trim() || hostOf(clean);
    if (isImageUrl(clean)) {
      // La URL è un'immagine (avatar/foto) → nodo immagine, non account.
      const img = makeEntity(toolId, 'media_url', clean, clean, {
        site,
        username,
        url: clean,
        fileUrl: clean,
        customTitle: `${site} image`
      });
      entities.push(img);
      edges.push(makeEdge(sourceId, img.id, `Image on ${site}`));
      return;
    }
    // Nodo 'social' (profilo): label = URL (favicon/colore auto come i nodi url),
    // header custom = "<Sito> account" via metadata.customTitle.
    const e = makeEntity(toolId, 'social', clean, clean, {
      site,
      username,
      url: clean,
      customTitle: `${site} account`
    });
    entities.push(e);
    edges.push(makeEdge(sourceId, e.id, `Account on ${site}`));
  };

  // 1) Prova JSON (maigret --json simple / sherlock output vari).
  const trimmed = output.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      // Maigret "simple" json: { site: { status:{ status:'Claimed' }, url_user } }
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [site, info] of Object.entries<any>(data)) {
          const status = info?.status?.status ?? info?.status;
          const url = info?.url_user ?? info?.url ?? info?.url_main;
          if (
            url &&
            (status === 'Claimed' || status === true || status === 'found')
          ) {
            addAccount(String(url), site);
          }
        }
      } else if (Array.isArray(data)) {
        for (const item of data) {
          const url = item?.url ?? item?.url_user;
          if (url) addAccount(String(url), item?.site ?? item?.name);
        }
      }
    } catch {
      /* fallthrough */
    }
  }

  // 2) Fallback: only parse confirmed account and image lines from console output.
  // Generic URL extraction would turn support links and profile metadata into false accounts.
  if (entities.length === 0) {
    for (const line of output.split('\n')) {
      const claimed = line.match(/\[\+\]\s*([^:]+):\s*(https?:\/\/\S+)/);
      if (claimed?.[2]) {
        addAccount(claimed[2].replace(/[.,;]+$/, ''), claimed[1]?.trim());
        continue;
      }

      const image = line.match(
        /[├└]─(?:image|image_url|avatar|avatar_url):\s*(https?:\/\/\S+)/i
      );
      if (image?.[1]) addAccount(image[1].replace(/[.,;]+$/, ''));
    }
  }

  if (entities.length === 0) {
    return {
      success: exitCode === 0 || exitCode === null,
      entities: [],
      edges: [],
      message: `${toolLabel}: no accounts found for ${username}.`
    };
  }

  return {
    success: true,
    entities,
    edges,
    message: `${toolLabel}: found ${entities.length} account(s) for ${username}.`
  };
}

export const containerTools: Record<string, ContainerToolDefinition> = {
  maigret: {
    id: 'maigret',
    name: 'Maigret',
    description:
      'Username OSINT (Maigret): searches profiles across hundreds of sites and extracts information.',
    image: 'soxoj/maigret:latest',
    supportsInput: (entity) => entity.type === 'username',
    // The JSON report is written inside the ephemeral container, so consume the
    // claimed-account console lines until the runner supports file artifacts.
    buildCommand: ({ input }) => [
      String(input.entity.value),
      '--no-progressbar',
      '--no-color',
      '--no-autoupdate',
      '--timeout',
      '10'
    ],
    parseOutput: ({ input, exitCode, output }) =>
      parseAccountsOutput({
        toolId: 'maigret',
        input,
        exitCode,
        output,
        toolLabel: 'Maigret'
      })
  },
  sherlock: {
    id: 'sherlock',
    name: 'Sherlock',
    description:
      'Username OSINT (Sherlock): searches usernames across hundreds of sites.',
    image: 'sherlock/sherlock:latest',
    supportsInput: (entity) => entity.type === 'username',
    buildCommand: ({ input }) => [
      String(input.entity.value),
      '--print-found',
      '--no-color',
      '--timeout',
      '10'
    ],
    parseOutput: ({ input, exitCode, output }) =>
      parseAccountsOutput({
        toolId: 'sherlock',
        input,
        exitCode,
        output,
        toolLabel: 'Sherlock'
      })
  },
  holehe: {
    id: 'holehe',
    name: 'Holehe',
    description:
      'Email OSINT (Holehe): checks 120+ sites to see whether an email is registered without alerting the target.',
    // Nessuna immagine ufficiale pubblicata: usiamo python slim e installiamo
    // holehe da PyPI al volo. L'email è passata come argv separato ($1), non
    // interpolata nello script (no shell injection).
    image: 'python:3.11-slim',
    supportsInput: (entity) => entity.type === 'email',
    buildCommand: ({ input }) => [
      'sh',
      '-c',
      'pip install --quiet --no-cache-dir holehe >&2 && holehe "$1" --only-used --no-color',
      'sh',
      String(input.entity.value)
    ],
    parseOutput: ({ input, exitCode, output }) => {
      const email = String(input.entity.value);
      const sourceId = input.entity.id;
      const entities: OSINTEntity[] = [];
      const edges: OSINTEdge[] = [];
      // holehe stampa "[+] site.com" per gli account trovati.
      for (const line of output.split('\n')) {
        const m = line.match(/\[\+\]\s*([a-z0-9.-]+\.[a-z]{2,})/i);
        if (!m) continue;
        const site = m[1].trim().toLowerCase();
        const url = `https://${site}`;
        const e = makeEntity('holehe', 'social', url, url, {
          site,
          email,
          url,
          customTitle: `${site} account`,
          method: 'holehe'
        });
        entities.push(e);
        edges.push(
          makeEdge(sourceId, e.id, `Registered on ${site}`, 'associated_with')
        );
      }
      if (entities.length === 0) {
        return {
          success: exitCode === 0 || exitCode === null,
          entities: [],
          edges: [],
          message: `Holehe: no accounts found for ${email}.`
        };
      }
      return {
        success: true,
        entities,
        edges,
        message: `Holehe: ${email} is registered on ${entities.length} site(s).`
      };
    }
  }
};

export function getContainerTool(toolId: string) {
  return Object.prototype.hasOwnProperty.call(containerTools, toolId)
    ? containerTools[toolId]
    : null;
}
