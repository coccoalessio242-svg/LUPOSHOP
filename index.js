import dotenv from 'dotenv';
import { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, EmbedBuilder, Events, REST, Routes, ApplicationCommandOptionType } from 'discord.js';

dotenv.config();

const {
  BOT_TOKEN,
  GUILD_ID,
  PANEL_CHANNEL_ID,
  VERIFY_PANEL_CHANNEL_ID,
  TICKET_ROLE_ID,
  LOG_CHANNEL_ID,
  ADMIN_ROLE_ID,
  ACCESS_ROLE_ID,
  BANNER_URL,
  DISCORD_ICON_URL,
} = process.env;

const DEFAULT_BANNER_URL = 'https://i.postimg.cc/CLCzYX7k/TICKET.png';
const SPAM_MAX_MESSAGES = 5;
const SPAM_TIME_WINDOW = 10000; // 10 secondi
const TIMEOUT_DURATION = 5 * 60 * 1000; // 5 minuti
const discordInvitePattern = /(https?:\/\/)?(www\.)?(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[\S]+/i;
const spamTracker = new Map();

if (!BOT_TOKEN || !GUILD_ID || !PANEL_CHANNEL_ID || !VERIFY_PANEL_CHANNEL_ID || !TICKET_ROLE_ID || !LOG_CHANNEL_ID || !ADMIN_ROLE_ID || !ACCESS_ROLE_ID) {
  console.error('Errore: alcune variabili di ambiente mancano. Controlla .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

const ticketButtons = [
  { label: '🛠️ SUPPORTO', style: ButtonStyle.Primary, id: 'ticket_SUPPORTO', description: 'Richiedi assistenza e supporto tecnico' },
  { label: '🛒 COMPRARE', style: ButtonStyle.Success, id: 'ticket_COMPRARE', description: 'Assistenza per acquisti e ordini' },
  { label: 'ℹ️ INFO', style: ButtonStyle.Secondary, id: 'ticket_INFO', description: 'Chiedi informazioni su servizi e offerte' },
  { label: '💬 SERVER DISCORD', style: ButtonStyle.Danger, id: 'ticket_SERVER_DISCORD', description: 'Supporto per il server Discord' },
];

function sanitizeChannelName(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildPanelEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🎫 LUPO SHOP TICKET')
    .setDescription('Scegli la categoria giusta e apri il ticket corretto.\nUn ticket aperto alla volta.')
    .addFields(
      { name: '🛠️ SUPPORTO', value: 'Richiedi assistenza su prodotti, ordini e problemi tecnici.', inline: false },
      { name: '🛒 COMPRARE', value: 'Apri un ticket per domande su acquisti, ordini e metodi di pagamento.', inline: false },
      { name: 'ℹ️ INFO', value: 'Chiedi tutte le informazioni su servizi, offerte e disponibilità.', inline: false },
      { name: '💬 SERVER DISCORD', value: 'Ricevi supporto per il server Discord e la community.', inline: false }
    )
    .setColor('#ffd43b')
    .setAuthor({ name: 'Lupo Shop', iconURL: DISCORD_ICON_URL || undefined })
    .setFooter({ text: 'Lupo Shop' });

  embed.setImage(BANNER_URL || DEFAULT_BANNER_URL);

  if (DISCORD_ICON_URL) {
    embed.setThumbnail(DISCORD_ICON_URL);
  }

  return embed;
}

function buildTicketButtons() {
  return ticketButtons.map((button) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(button.id).setLabel(button.label).setStyle(button.style)
    )
  );
}

function buildTicketActionRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('close_ticket').setLabel('❌ CHIUDI').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('reclama_ticket').setLabel('📣 RECLAMA').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function createTicketPanel(interaction) {
  if (!interaction.guild) return;

  const embed = buildPanelEmbed();
  const rows = buildTicketButtons();

  await interaction.reply({ content: 'Pannello ticket creato.', ephemeral: true });
  const channel = await interaction.guild.channels.fetch(PANEL_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.followUp({ content: 'Errore: il canale panel non è stato trovato o non è un canale testuale.', ephemeral: true });
    return;
  }

  await channel.send({ embeds: [embed], components: rows });
}

function buildVerifyPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('✅ LUPO SHOP VERIFICA')
    .setDescription('Clicca il pulsante qui sotto per ottenere il ruolo di accesso al server.')
    .setColor('#ffd43b')
    .setAuthor({ name: 'Lupo Shop', iconURL: DISCORD_ICON_URL || undefined })
    .setFooter({ text: 'Verifica l’accesso a Lupo Shop' })
    .setImage(BANNER_URL || DEFAULT_BANNER_URL);
}

function buildVerifyButtonRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_VERIFICA').setLabel('✅ VERIFICA').setStyle(ButtonStyle.Success)
    ),
  ];
}

async function createVerifyPanel(interaction) {
  if (!interaction.guild) return;

  const embed = buildVerifyPanelEmbed();
  const rows = buildVerifyButtonRow();

  await interaction.reply({ content: 'Pannello verifica creato.', ephemeral: true });
  const channel = await interaction.guild.channels.fetch(VERIFY_PANEL_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.followUp({ content: 'Errore: il canale di verifica non è stato trovato o non è un canale testuale.', ephemeral: true });
    return;
  }

  await channel.send({ embeds: [embed], components: rows });
}

function isTicketChannel(channel) {
  return channel && channel.type === ChannelType.GuildText && (channel.topic?.startsWith('ticket:') || channel.name.startsWith('ticket-'));
}

async function addUserToTicketChannel(interaction) {
  if (!interaction.guild || !interaction.channel || !interaction.isChatInputCommand()) return;
  if (!isTicketChannel(interaction.channel)) {
    await interaction.reply({ content: 'Questo comando deve essere usato all’interno di un canale ticket.', ephemeral: true });
    return;
  }

  if (!userCanManage(interaction)) {
    await interaction.reply({ content: 'Solo il ruolo ticket o admin può aggiungere persone al ticket.', ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('utente', true);
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'Utente non trovato nel server.', ephemeral: true });
    return;
  }

  const alreadyHasAccess = interaction.channel.permissionsFor(targetMember)?.has(PermissionFlagsBits.ViewChannel);
  if (alreadyHasAccess) {
    await interaction.reply({ content: `${targetUser} ha già accesso a questo ticket.`, ephemeral: true });
    return;
  }

  await interaction.channel.permissionOverwrites.create(targetMember, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });

  await interaction.reply({ content: `✅ ${targetUser} è stato aggiunto al ticket.`, ephemeral: true });
  await interaction.channel.send({ content: `🔒 ${targetUser} è stato aggiunto al ticket da ${interaction.user}.` });
}

async function getExistingTicketChannel(guild, userId) {
  return guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.topic === `ticket:${userId}`);
}

async function ensureTicketCategory(guild, categoryName) {
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase()
  );

  if (!category) {
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
    });
  }

  return category;
}

async function createTicketChannel(interaction, ticketType) {
  if (!interaction.guild || !interaction.member || !interaction.user) return null;
  const guild = interaction.guild;
  const existing = await getExistingTicketChannel(guild, interaction.user.id);

  if (existing) {
    await interaction.reply({ content: `Hai già un ticket aperto: ${existing}`, ephemeral: true });
    return null;
  }

  const categoryName = `Tickets - ${ticketType}`;
  const category = await ensureTicketCategory(guild, categoryName);

  const channelName = sanitizeChannelName(`ticket-${interaction.user.username}-${ticketType}`);
  const ticketRole = await guild.roles.fetch(TICKET_ROLE_ID);
  if (!ticketRole) {
    await interaction.reply({ content: 'Errore: ruolo ticket non trovato.', ephemeral: true });
    return null;
  }

  const channel = await guild.channels.create({
    name: channelName.slice(0, 90),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `ticket:${interaction.user.id}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: ticketRole.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: ADMIN_ROLE_ID,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ],
  });

  return channel;
}

function buildTicketEmbed(user, ticketType) {
  const embed = new EmbedBuilder()
    .setTitle(`Ticket aperto: ${ticketType}`)
    .setDescription(`Ciao ${user}!
TI ASSISTEREMO A BREVE.
Descrivi bene il tuo problema o la tua richiesta.`)
    .addFields(
      { name: 'Categoria', value: ticketType, inline: true },
      { name: 'Indicazioni', value: 'Fornisci informazioni chiare e dettagliate. Il team Lupo Shop risponderà qui.', inline: true }
    )
    .setColor('#1abc9c')
    .setAuthor({ name: 'Lupo Shop', iconURL: DISCORD_ICON_URL || undefined })
    .setFooter({ text: 'Lupo Shop' });

  if (DISCORD_ICON_URL) {
    embed.setThumbnail(DISCORD_ICON_URL);
  }

  return embed;
}

function userCanManage(interaction) {
  const member = interaction.member;
  if (!member || !interaction.guild) return false;
  const roleCache = member.roles?.cache || (member.roles ? member.roles : null);
  const hasTicketRole = roleCache?.has(TICKET_ROLE_ID);
  const hasAdminRole = roleCache?.has(ADMIN_ROLE_ID);
  return Boolean(hasTicketRole || hasAdminRole);
}

async function generateTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = sorted.map((message) => {
    const timestamp = new Date(message.createdTimestamp).toISOString().replace('T', ' ').replace('Z', '');
    const author = `${message.author.tag}`;
    const content = message.content || '';
    const attachmentText = message.attachments.size > 0 ? ` [${message.attachments.map((a) => a.url).join(', ')}]` : '';
    return `[${timestamp}] ${author}: ${content}${attachmentText}`;
  });

  return lines.join('\n');
}

function parseTicketInfo(channel) {
  const ticketAuthorId = channel.topic?.startsWith('ticket:') ? channel.topic.split(':')[1] : null;
  const categoryName = channel.parent?.name || '';
  const ticketType = categoryName.replace(/^Tickets - /i, '') || channel.name.replace(/^ticket-/, '');
  return { ticketAuthorId, ticketType };
}

async function closeTicket(interaction) {
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) return;
  if (!userCanManage(interaction)) {
    await interaction.reply({ content: 'Solo il ruolo ticket o admin può chiudere questo ticket.', ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  const { ticketAuthorId, ticketType } = parseTicketInfo(channel);
  const transcript = await generateTranscript(channel);
  const transcriptFile = { attachment: Buffer.from(transcript, 'utf-8'), name: `${channel.name}-transcript.txt` };
  const closedBy = `${interaction.user.tag}`;
  const openedBy = ticketAuthorId ? `<@${ticketAuthorId}>` : 'Utente non trovato';
  const openedById = ticketAuthorId || 'Sconosciuto';
  const reason = 'Risolto o chiuso da staff';

  const embed = new EmbedBuilder()
    .setTitle('📄 Transcript ticket')
    .setDescription(`Scarica questo file ed aprilo con il tuo browser per visualizzare il tuo ticket.`)
    .setColor('#2ecc71')
    .addFields(
      { name: 'Trascrizione del ticket', value: channel.name, inline: false },
      { name: 'Chiuso da', value: closedBy, inline: true },
      { name: 'Motivazione Chiusura', value: reason, inline: true },
      { name: 'Categoria ticket', value: ticketType || 'TICKET GENERALE', inline: true },
      { name: 'Aperto da', value: openedBy, inline: true },
      { name: 'ID Utente', value: openedById, inline: true }
    )
    .setFooter({ text: 'Lupo Shop' })
    .setTimestamp();

  const logChannel = await interaction.guild.channels.fetch(LOG_CHANNEL_ID);
  if (logChannel && logChannel.isTextBased()) {
    await logChannel.send({ embeds: [embed], files: [transcriptFile] });
  }

  if (ticketAuthorId) {
    try {
      const member = await interaction.guild.members.fetch(ticketAuthorId);
      if (member) {
        await member.send({ embeds: [embed], files: [transcriptFile] });
      }
    } catch (err) {
      console.warn('Impossibile inviare DM al cliente:', err);
    }
  }

  await interaction.reply({ content: `✅ Ticket chiuso da ${interaction.user.tag}. Transcript inviato e canale eliminato.`, ephemeral: true });
  setTimeout(() => channel.delete().catch(() => {}), 3000);
}

async function grantAccessRole(interaction) {
  if (!interaction.guild) return;

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: 'Impossibile trovare il tuo profilo nel server.', ephemeral: true });
    return;
  }

  const accessRole = await interaction.guild.roles.fetch(ACCESS_ROLE_ID).catch(() => null);
  if (!accessRole) {
    await interaction.reply({ content: 'Errore: ruolo di accesso non trovato. Contatta lo staff.', ephemeral: true });
    return;
  }

  if (member.roles.cache.has(accessRole.id)) {
    await interaction.reply({ content: 'Hai già il ruolo di accesso.', ephemeral: true });
    return;
  }

  await member.roles.add(accessRole, 'Verifica Lupo Shop');
  await interaction.reply({ content: '✅ Verifica completata! Hai ricevuto il ruolo di accesso.', ephemeral: true });
}

async function reclamaTicket(interaction) {
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) return;
  if (!userCanManage(interaction)) {
    await interaction.reply({ content: 'Solo il ruolo ticket o admin può reclamare il ticket.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('🔔 Reclamo ticket')
    .setDescription(`${interaction.user} ha reclamato questo ticket.`)
    .setColor('#ff8c00')
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot pronto come ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  const commandData = [
    {
      name: 'ticket-panel',
      description: 'Crea il pannello dei ticket nel canale panel configurato',
    },
    {
      name: 'verify-panel',
      description: 'Crea il pannello di verifica in un canale separato',
    },
    {
      name: 'aggiungi',
      description: 'Aggiunge un membro al ticket corrente',
      options: [
        {
          name: 'utente',
          description: 'Utente da aggiungere al ticket',
          type: ApplicationCommandOptionType.User,
          required: true,
        },
      ],
    },
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commandData });
    console.log('Comandi slash registrati. Usa /ticket-panel e /verify-panel nel server.');
  } catch (error) {
    console.error('Errore registrando i comandi slash:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'ticket-panel') {
      await createTicketPanel(interaction);
    } else if (interaction.commandName === 'verify-panel') {
      await createVerifyPanel(interaction);
    } else if (interaction.commandName === 'aggiungi') {
      await addUserToTicketChannel(interaction);
    }
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === 'ticket_VERIFICA') {
    await grantAccessRole(interaction);
    return;
  }

  if (interaction.customId.startsWith('ticket_')) {
    const ticketType = interaction.customId.split('_').slice(1).join(' ');
    const channel = await createTicketChannel(interaction, ticketType);

    if (!channel) return;

    const ticketEmbed = buildTicketEmbed(interaction.user, ticketType);
    const actionRow = buildTicketActionRow();
    const ticketRole = await interaction.guild.roles.fetch(TICKET_ROLE_ID);

    await interaction.reply({ content: `${ticketRole ? `<@&${ticketRole.id}>` : '@ticket'}
✅ Ticket creato: ${channel}
Ti assisteremo a breve.`, ephemeral: true });
    await channel.send({ embeds: [ticketEmbed], components: actionRow });
    return;
  }

  if (interaction.customId === 'close_ticket') {
    await closeTicket(interaction);
    return;
  }

  if (interaction.customId === 'reclama_ticket') {
    await reclamaTicket(interaction);
    return;
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild || !message.member) return;

  const isAdmin = message.member.roles.cache.has(ADMIN_ROLE_ID);

  if (!isAdmin && discordInvitePattern.test(message.content)) {
    await message.delete().catch(() => null);
    const reply = await message.channel.send({ content: `${message.author}, i link Discord sono vietati se non sei un admin.`, allowedMentions: { repliedUser: false } });
    setTimeout(() => reply.delete().catch(() => null), 5000);
    return;
  }

  if (isAdmin) return;

  const now = Date.now();
  const recentMessages = (spamTracker.get(message.author.id) || []).filter((timestamp) => now - timestamp <= SPAM_TIME_WINDOW);
  recentMessages.push(now);
  spamTracker.set(message.author.id, recentMessages);

  if (recentMessages.length >= SPAM_MAX_MESSAGES) {
    await message.delete().catch(() => null);
    spamTracker.delete(message.author.id);

    try {
      await message.member.timeout(TIMEOUT_DURATION, 'Spam eccessivo');
      const timeoutNotice = await message.channel.send({ content: `${message.author}, hai inviato troppi messaggi in poco tempo e sei stato messo in timeout per 5 minuti.`, allowedMentions: { repliedUser: false } });
      setTimeout(() => timeoutNotice.delete().catch(() => null), 5000);
    } catch (error) {
      console.warn('Impossibile applicare timeout:', error);
    }
  }
});

client.login(BOT_TOKEN);
