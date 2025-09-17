'use client';

import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageSquare,
  X,
  Send,
  Menu,
  Scale,
  Users,
  BookOpen,
  Award,
  Phone,
  Mail,
  MapPin,
  Settings,
  Lock,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/* ===============================
   CONFIG (reemplazar por valores reales)
   =============================== */

const OPENAI_API_KEY = "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";
const WEBHOOK_URL = "https://hook.us2.make.com/vud5drreranum1p76are8no6gt1vu9ir";

/* ===============================
   UI CONSTANTES (paleta accesible)
   =============================== */

const FIELD_ORDER = [
  "nombreCompleto",
  "email",
  "telefono",
  "areaLegal",
  "descripcion",
  "ciudad",
  "preferenciaContacto",
  "disponibilidad",
  "aceptaPolitica",
] as const;
type FieldKey = typeof FIELD_ORDER[number];

const FIELD_QUESTIONS: Record<FieldKey, string> = {
  nombreCompleto: "Para comenzar, ¿cuál es su nombre y apellido completos?",
  email: "¿Cuál es su correo electrónico de contacto?",
  telefono: "¿Cuál es su número de teléfono (con prefijo) para coordinar la cita?",
  areaLegal:
    "¿En qué área legal encuadra su consulta? (familia, laboral, penal, civil, mercantil, fiscal, inmigración, etc.)",
  descripcion: "Describa brevemente el motivo de su consulta (hechos esenciales y fecha aproximada).",
  ciudad: "¿En qué ciudad y país se encuentra el asunto (jurisdicción)?",
  preferenciaContacto: "¿Prefiere que le contactemos por email, teléfono o WhatsApp?",
  disponibilidad: "¿Qué días y horarios le resultan cómodos para la primera llamada?",
  aceptaPolitica:
    "Para continuar, confirme que acepta nuestra política de privacidad y tratamiento de datos (responda “sí” o “no”).",
};

/* ===============================
   🔎 EXTRACCIÓN + NORMALIZACIÓN
   =============================== */
function normalizeText(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function toTitleCase(s: string) {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

function extractEmail(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}
function extractPhone(text: string): string | null {
  const m = text.match(/(\+?\d[\d\s().-]{6,}\d)/);
  return m ? m[1] : null;
}
function extractName(text: string): string | null {
  const v = text.trim();
  let m =
    v.match(/me llamo\s+([a-záéíóúüñ.' -]{3,})/i) ||
    v.match(/mi nombre es\s+([a-záéíóúüñ.' -]{3,})/i) ||
    v.match(/\bsoy\s+([a-záéíóúüñ.'-]+(?:\s+[a-záéíóúüñ.'-]+){1,3})\b/i);
  if (m) {
    let name = m[1];
    name = name.split(/,| y | que | porque | para | con /i)[0].trim();
    name = name.replace(/[,.;].*$/, "").trim();
    if (name.split(/\s+/).length >= 2) return toTitleCase(name);
  }
  return null;
}
function extractCity(text: string): string | null {
  const v = text.replace(/\n/g, " ");
  let m =
    v.match(/\b(soy de|estoy en|vivo en|resido en|desde)\s+([a-záéíóúüñ ]{2,})/i) ||
    v.match(/\b(ciudad|localidad|jurisdicci[oó]n)\s*:\s*([a-záéíóúüñ ]{2,})/i);
  if (m) {
    let city = (m[2] || "").trim();
    city = city.replace(/[,.;].*$/, "").trim();
    return toTitleCase(city);
  }
  return null;
}
function canonicalPreference(text: string): "email" | "teléfono" | "WhatsApp" | null {
  const t = normalizeText(text);
  if (/whats?app/.test(t)) return "WhatsApp";
  if (/\b(mail|correo|email)\b/.test(t)) return "email";
  if (/\b(telefono|teléfono|llamad)\b/.test(t)) return "teléfono";
  return null;
}
const AREA_CANON = [
  "familia",
  "laboral",
  "penal",
  "civil",
  "mercantil",
  "fiscal",
  "inmigración",
  "administrativo",
  "inmobiliario",
  "sucesiones",
] as const;
type AreaCanon = typeof AREA_CANON[number];

function toCanonicalArea(text: string): AreaCanon | null {
  const t = normalizeText(text);
  if (/(familia|familiar|divorci|custodi|alimento|separaci)/.test(t)) return "familia";
  if (/(laboral|trabaj|despid|acoso laboral|indemniz)/.test(t)) return "laboral";
  if (/(penal|delit|denunci|estaf|lesion|hurto|robo|violenci|amenaz)/.test(t)) return "penal";
  if (/(civil|contrat|deud|responsabil)/.test(t)) return "civil";
  if (/(mercantil|societ|empresa|corporativ|concurso)/.test(t)) return "mercantil";
  if (/(fiscal|tribut|impuest|hacienda)/.test(t)) return "fiscal";
  if (/(inmig|extranjer|residen|asilo|permiso)/.test(t)) return "inmigración";
  if (/(administrativ|multa|sanci|ayunt|licenc)/.test(t)) return "administrativo";
  if (/(inmobiliari|hipotec|desahuci|alquiler)/.test(t)) return "inmobiliario";
  if (/(sucesion|herenc|testament)/.test(t)) return "sucesiones";
  return null;
}

/* Autocompletado CONSERVADOR (no pisa datos si no hay patrón claro) */
function opportunisticFill(f: Record<FieldKey, string>, text: string): Record<FieldKey, string> {
  const out = { ...f };
  if (!out.nombreCompleto) {
    const n = extractName(text);
    if (n) out.nombreCompleto = n;
  }
  if (!out.email) {
    const e = extractEmail(text);
    if (e) out.email = e;
  }
  if (!out.telefono) {
    const p = extractPhone(text);
    if (p) out.telefono = p;
  }
  if (!out.areaLegal) {
    const a = toCanonicalArea(text);
    if (a) out.areaLegal = a;
  }
  if (!out.ciudad) {
    const c = extractCity(text);
    if (c) out.ciudad = c;
  }
  if (!out.preferenciaContacto) {
    const pc = canonicalPreference(text);
    if (pc) out.preferenciaContacto = pc;
  }
  // disponibilidad: NO autocompletamos; requiere pregunta directa para evitar ruido.
  return out;
}

/* ===== Detección robusta de "nombre y apellido" ingresado en crudo ===== */
function isLikelyFullName(v: string) {
  const txt = v.trim().replace(/\s+/g, " ");
  const tokens = txt.split(" ");
  if (tokens.length < 2 || tokens.length > 4) return false;
  const first = normalizeText(tokens[0]);
  // Evitar confundir saludos u otras frases con nombres
  const banned = ["hola", "buenas", "buenos", "buenasnoches", "buenastardes", "maestro", "consulta", "crisis", "porque", "necesito"];
  if (banned.includes(first)) return false;
  return tokens.every((t) => /^[A-Za-zÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑ'’.-]{1,}$/.test(t));
}

/* ===============================
   ✅ VALIDACIONES por campo
   =============================== */
const YES_RE = /^\s*(s[ií]|sí|si|ok|de acuerdo|confirmo|correcto|afirmativo)\s*$/i;
const NO_RE = /^\s*(no|negativo|prefiero corregir|corregir|modificar|cambiar|editar)\b/i;

const validators: Record<FieldKey, (v: string) => true | string> = {
  nombreCompleto: (v) => {
    const ok = /^[A-Za-zÁÉÍÓÚÜÑ'’.-]+(?:\s+[A-Za-zÁÉÍÓÚÜÑ'’.-]+)+$/.test(v.trim());
    return ok ? true : "Necesito nombre y apellido (sin detalles del caso).";
  },
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? true : "Ingrese un email válido."),
  telefono: (v) => (v.replace(/[^0-9+]/g, "").length >= 8 ? true : "Ingrese un teléfono válido con prefijo."),
  areaLegal: (v) =>
    AREA_CANON.includes(v as AreaCanon)
      ? true
      : "Debe ser una de: familia, laboral, penal, civil, mercantil, fiscal, inmigración, administrativo, inmobiliario o sucesiones.",
  descripcion: (v) => (v.trim().length >= 10 ? true : "Necesito 1–2 frases que orienten al letrado (≥10 caracteres)."),
  ciudad: (v) => (v.trim().length >= 2 ? true : "Indique ciudad y país/jurisdicción."),
  preferenciaContacto: (v) =>
    ["email", "teléfono", "WhatsApp"].includes(v) ? true : "Elija email, teléfono o WhatsApp.",
  disponibilidad: (v) =>
    /(\blun|mar|mi[eé]r|jue|vie|s[aá]b|dom\b|\d{1,2}\s*(am|pm|hs|h)\b|\d{1,2}:\d{2})/i.test(v)
      ? true
      : "Indique días y/o horarios (ej.: “martes y jueves por la tarde” o “Lun a Vie 9–13”).",
  aceptaPolitica: (v) => (/^s(i|í)$/i.test(v) ? true : "Para continuar debe responder “sí”."),
};

/* Sanitizado FINAL cuando la pregunta fue explícita */
function sanitize(field: FieldKey, value: string) {
  const v = value.trim();

  if (field === "nombreCompleto") {
    // 1) patrones “me llamo/soy/mi nombre”
    const n = extractName(v);
    if (n) return n;
    // 2) si escribió “Cristian Geerken” crudo, aceptarlo si parece nombre real
    if (isLikelyFullName(v)) return toTitleCase(v);
    // 3) si no, no guardo nada → repregunta
    return "";
  }
  if (field === "email") {
    const m = extractEmail(v);
    return m ? m : "";
  }
  if (field === "telefono") {
    const m = extractPhone(v);
    return m ? m : "";
  }
  if (field === "ciudad") {
    const c = extractCity(v) || v.replace(/[,.;].*$/, "");
    return toTitleCase(c);
  }
  if (field === "preferenciaContacto") {
    const pc = canonicalPreference(v);
    return pc ? pc : "";
  }
  if (field === "aceptaPolitica") {
    return /^s(i|í)$/i.test(v) ? "sí" : "";
  }
  if (field === "areaLegal") {
    const a = toCanonicalArea(v);
    return a ? a : "";
  }
  if (field === "disponibilidad") {
    return v; // validación la hace validators
  }
  if (field === "descripcion") {
    return v.replace(/\s+/g, " ").trim();
  }
  return v;
}

function nextMissingField(f: Record<FieldKey, string>): FieldKey | null {
  for (const k of FIELD_ORDER) {
    if (!f[k]) return k;
  }
  return null;
}

function findFirstInvalid(f: Record<FieldKey, string>): { field: FieldKey; reason: string } | null {
  for (const k of FIELD_ORDER) {
    if (!f[k]) return null; // aún faltan, no validamos el resto
    const res = validators[k](f[k]);
    if (res !== true) return { field: k, reason: res };
  }
  return null;
}

function summarizeForm(f: Record<FieldKey, string>) {
  return [
    `• Nombre completo: ${f.nombreCompleto}`,
    `• Email: ${f.email}`,
    `• Teléfono: ${f.telefono}`,
    `• Área legal: ${toTitleCase(f.areaLegal)}`,
    `• Descripción: ${f.descripcion}`,
    `• Ciudad/Jurisdicción: ${f.ciudad}`,
    `• Preferencia de contacto: ${f.preferenciaContacto}`,
    `• Disponibilidad: ${f.disponibilidad}`,
  ].join("\n");
}

/* ===============================
   🗣️ PREPROMPT
   =============================== */
const DEFAULT_PREPROMPT = `
Eres el Asistente de Intake de LEX IA. Tu rol es SOLO recopilar datos mínimos para la primera cita.
Reglas:
1) Pregunta de a un campo por turno y usa frases cortas y profesionales.
2) Orden de campos: nombreCompleto → email → telefono → areaLegal → descripcion → ciudad → preferenciaContacto → disponibilidad → aceptaPolitica.
3) Si el usuario se desvía, redirígelo amablemente a la pregunta pendiente.
4) Cuando tengas todos los campos válidos, NO inventes nada: espera a que el sistema muestre el resumen y pida confirmación.
5) No des asesoramiento jurídico sustantivo; esto es solo agendar la primera cita.
Tono: profesional, claro, empático.
`;

type ChatMessage = { sender: "user" | "bot"; text: string; timestamp: string };

export default function HomePage() {
  // UI: chatbot + admin
  const [chatOpen, setChatOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Prompt configurable
  const [prePrompt, setPrePrompt] = useState(() => {
    return typeof window !== "undefined"
      ? localStorage.getItem("lexia-preprompt") || DEFAULT_PREPROMPT
      : DEFAULT_PREPROMPT;
  });
  const [tempPrePrompt, setTempPrePrompt] = useState(prePrompt);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      sender: "bot",
      text:
        "Bienvenido a LEX IA, Inteligencia Artificial especializada para Profesionales del Derecho. Soy su asistente virtual y estoy aquí para ayudarle con su consulta legal. ¿En qué podemos asistirle hoy?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Intake state
  const [form, setForm] = useState<Record<FieldKey, string>>({
    nombreCompleto: "",
    email: "",
    telefono: "",
    areaLegal: "",
    descripcion: "",
    ciudad: "",
    preferenciaContacto: "",
    disponibilidad: "",
    aceptaPolitica: "",
  });
  const [lastAsked, setLastAsked] = useState<FieldKey | null>(null);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [conversationId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())
  );

  // Utils
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Empujar la primera pregunta al abrir el chat
  useEffect(() => {
    if (chatOpen && !lastAsked && !confirmationPending) {
      const firstQ = FIELD_QUESTIONS["nombreCompleto"];
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: firstQ,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      setLastAsked("nombreCompleto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);

  // Admin
  const handleAdminAccess = () => {
    if (passwordInput === "1234") {
      setIsAuthenticated(true);
      setPasswordInput("");
    } else {
      alert("Contraseña incorrecta");
      setPasswordInput("");
    }
  };
  const handleSavePrePrompt = () => {
    setPrePrompt(tempPrePrompt);
    if (typeof window !== "undefined") localStorage.setItem("lexia-preprompt", tempPrePrompt);
    setAdminOpen(false);
    setIsAuthenticated(false);
    alert("Pre-prompt guardado exitosamente");
  };
  const handleAdminClose = () => {
    setAdminOpen(false);
    setIsAuthenticated(false);
    setPasswordInput("");
    setTempPrePrompt(prePrompt);
  };

  // Make webhook
  async function postToMake(payload: any) {
    try {
      console.log("Enviando a Make:", payload);
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("Error enviando a Make:", e);
    }
  }

  /* ===============================
     📤 Enviar mensaje (control de flujo + validación fuerte)
     =============================== */
  const sendMessage = async () => {
    if (!input.trim()) return;

    // 1) Render inmediato del mensaje del usuario
    const userMessage: ChatMessage = {
      sender: "user",
      text: input,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMessage]);

    // 2) Intento registrar respuesta al campo actual (si había)
    let currentForm = { ...form };
    if (lastAsked) {
      const cleaned = sanitize(lastAsked, input);
      if (!cleaned) {
        // No pude extraer un valor válido
        setMessages((prev) => [
          ...prev,
          {
            sender: "bot",
            text: `${validators[lastAsked]("") as string} ${FIELD_QUESTIONS[lastAsked]}`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        setInput("");
        return; // no llamo al LLM, repregunto directo
      }
      const valid = validators[lastAsked](cleaned);
      if (valid !== true) {
        setMessages((prev) => [
          ...prev,
          {
            sender: "bot",
            text: `${valid} ${FIELD_QUESTIONS[lastAsked]}`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        setInput("");
        return;
      }
      currentForm[lastAsked] = cleaned;
    }

    // 3) Autocompletado conservador desde este mensaje y transcript de usuario
    currentForm = opportunisticFill(currentForm, userMessage.text);
    const userTranscript = [...messages, userMessage]
      .filter((m) => m.sender === "user")
      .map((m) => m.text)
      .join("\n");
    currentForm = opportunisticFill(currentForm, userTranscript);

    setForm(currentForm);
    setInput("");
    setLoading(true);

    try {
      // 4) Si faltan campos → pedir el siguiente
      let pendingField = nextMissingField(currentForm);

      // Si no faltan, validar TODOS antes de confirmar
      if (!pendingField) {
        const invalid = findFirstInvalid(currentForm);
        if (invalid) {
          setConfirmationPending(false);
          setLastAsked(invalid.field);
          setMessages((prev) => [
            ...prev,
            {
              sender: "bot",
              text: `${invalid.reason} ${FIELD_QUESTIONS[invalid.field]}`,
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
          setLoading(false);
          return;
        }
      }

      // 5) Si ya tengo todo y aún no pedí confirmación → mostrar RESUMEN determinista
      if (!pendingField && !confirmationPending) {
        const resumen = summarizeForm(currentForm);
        setConfirmationPending(true);
        setLastAsked(null);
        setMessages((prev) => [
          ...prev,
          {
            sender: "bot",
            text: `Revisá el resumen y decime si está correcto para enviarlo al letrado:\n\n${resumen}\n\n¿Confirmás con “sí” o querés corregir algo?`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        setLoading(false);
        return;
      }

      // 6) Si estoy esperando confirmación → evaluar respuesta
      if (!pendingField && confirmationPending) {
        const t = userMessage.text;
        if (YES_RE.test(t)) {
          const transcript = [...messages, userMessage].map((m) => `[${m.sender}] ${m.text}`).join("\n");
          const payload = {
            timestamp: new Date().toISOString(),
            ...currentForm,
            origenURL: typeof window !== "undefined" ? window.location.href : "",
            conversationId,
            transcript,
          };
          await postToMake(payload);

          setMessages((prev) => [
            ...prev,
            {
              sender: "bot",
              text:
                "Perfecto, acabo de enviar tus datos al letrado. En breve se pondrán en contacto para agendar la segunda cita. ¿Necesitás algo más?",
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
          setConfirmationPending(false);
          setLastAsked(null);
          setLoading(false);
          return;
        } else if (NO_RE.test(t)) {
          // vuelve al primer campo para corregir
          setConfirmationPending(false);
          setLastAsked(FIELD_ORDER[0]);
          setMessages((prev) => [
            ...prev,
            {
              sender: "bot",
              text: `Entendido, vamos a corregir. ${FIELD_QUESTIONS[FIELD_ORDER[0]]}`,
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
          setLoading(false);
          return;
        } else {
          setMessages((prev) => [
            ...prev,
            {
              sender: "bot",
              text: "¿Podés responder “sí” para confirmar o indicarme qué dato querés corregir?",
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
          setLoading(false);
          return;
        }
      }

      // 7) Todavía faltan campos → preguntá SOLO el que corresponde (con LLM para redacción breve)
      const controlSystem = `Campo a preguntar ahora: ${pendingField}. Formula SOLO esta pregunta: "${FIELD_QUESTIONS[pendingField!]}". Mantén el tono profesional y breve.`;
      const history = [
        { role: "system", content: prePrompt },
        { role: "system", content: `Campos capturados hasta ahora (JSON): ${JSON.stringify(currentForm)}` },
        { role: "system", content: controlSystem },
        ...messages.map((m) => ({
          role: m.sender === "user" ? "user" : "assistant",
          content: m.text,
        })),
        { role: "user", content: userMessage.text },
      ];

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: history as any,
        }),
      });

      const data = await response.json();
      const botReply: string =
        data?.choices?.[0]?.message?.content || FIELD_QUESTIONS[pendingField as FieldKey];

      setLastAsked(pendingField as FieldKey);
      setConfirmationPending(false);
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: botReply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text:
            "⚠️ Error al conectar con nuestro sistema de IA. Por favor, inténtelo más tarde o contacte directamente a nuestro despacho.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  /* ===============================
     UI
     =============================== */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="relative bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-600/10 to-transparent"></div>
        <div className="relative max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg shadow-lg">
                <Scale className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">
                  <span className="bg-gradient-to-r from-amber-400 to-amber-500 bg-clip-text text-transparent">
                    LEX
                  </span>
                  <span className="ml-1 text-white">IA</span>
                </h1>
                <p className="text-xs text-slate-300 font-medium">Inteligencia Artificial Jurídica</p>
              </div>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center space-x-8 text-sm font-medium">
              {["Inicio", "Sobre Nosotros", "Servicios", "Casos de Éxito", "Blog", "Contacto"].map((item) => (
                <a
                  key={item}
                  href="#"
                  className="text-slate-300 hover:text-amber-400 transition-colors duration-300 px-3 py-2 rounded-md hover:bg-slate-800/50"
                >
                  {item}
                </a>
              ))}

              {/* Admin Button */}
              <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-400 bg-transparent"
                    onClick={() => setAdminOpen(true)}
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Admin
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px] bg-slate-900 border-slate-700 text-white">
                  <DialogHeader>
                    <DialogTitle className="text-amber-400 flex items-center">
                      <Lock className="w-5 h-5 mr-2" />
                      Panel de Administración
                    </DialogTitle>
                  </DialogHeader>

                  {!isAuthenticated ? (
                    <div className="space-y-4">
                      <p className="text-slate-300">Ingrese la contraseña de administrador:</p>
                      <div className="flex space-x-2">
                        <Input
                          type="password"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="Contraseña"
                          className="bg-slate-800 border-slate-600 text-white"
                          onKeyDown={(e) => e.key === "Enter" && handleAdminAccess()}
                        />
                        <Button onClick={handleAdminAccess} className="bg-amber-600 hover:bg-amber-700">
                          Acceder
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Configurar Pre-prompt del Asistente:
                        </label>
                        <Textarea
                          value={tempPrePrompt}
                          onChange={(e) => setTempPrePrompt(e.target.value)}
                          className="min-h-[200px] bg-slate-800 border-slate-600 text-white resize-none"
                          placeholder="Ingrese las instrucciones para el asistente de IA..."
                        />
                      </div>
                      <div className="flex justify-end space-x-2">
                        <Button
                          variant="outline"
                          onClick={handleAdminClose}
                          className="border-slate-600 text-slate-300 hover:bg-slate-800"
                        >
                          Cancelar
                        </Button>
                        <Button onClick={handleSavePrePrompt} className="bg-amber-600 hover:bg-amber-700">
                          Guardar Pre-prompt
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </nav>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-md hover:bg-slate-800/50 transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <nav className="lg:hidden mt-4 pb-4 border-t border-slate-700/50 pt-4">
              <div className="flex flex-col space-y-2">
                {["Inicio", "Sobre Nosotros", "Servicios", "Casos de Éxito", "Blog", "Contacto"].map((item) => (
                  <a
                    key={item}
                    href="#"
                    className="text-slate-300 hover:text-amber-400 transition-colors duration-300 px-3 py-2 rounded-md hover:bg-slate-800/50"
                  >
                    {item}
                  </a>
                ))}
                <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-400 bg-transparent w-fit"
                      onClick={() => setAdminOpen(true)}
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      Admin
                    </Button>
                  </DialogTrigger>
                </Dialog>
              </div>
            </nav>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 py-20 lg:py-32">
          <div className="text-center max-w-4xl mx-auto">
            <div className="mb-8 inline-flex items-center px-4 py-2 bg-amber-100 text-amber-800 rounded-full text-sm font-medium">
              <Award className="w-4 h-4 mr-2" />
              Tecnología de Vanguardia para el Sector Legal
            </div>

            <h2 className="text-4xl lg:text-6xl font-bold text-slate-900 mb-6 leading-tight">
              Inteligencia Artificial para
              <span className="bg-gradient-to-r from-amber-600 to-amber-500 bg-clip-text text-transparent">
                {" "}
                Profesionales del Derecho
              </span>
            </h2>

            <p className="text-xl text-slate-600 mb-10 max-w-3xl mx-auto leading-relaxed">
              LEX IA revoluciona la práctica jurídica mediante inteligencia artificial avanzada, permitiendo a abogados
              y despachos optimizar su tiempo, automatizar procesos complejos y obtener análisis jurídicos precisos en
              segundos.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button
                size="lg"
                className="bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 text-white px-8 py-4 rounded-xl shadow-lg hover:shadow-xl transition-all duración-300 transform hover:scale-105 font-semibold"
              >
                Solicitar Demostración Gratuita
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="border-2 border-slate-300 text-slate-700 hover:bg-slate-50 px-8 py-4 rounded-xl font-semibold"
              >
                Ver Casos de Éxito
              </Button>
            </div>
          </div>

          {/* Features Grid */}
          <div className="mt-20 lg:mt-32">
            <div className="text-center mb-16">
              <h3 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-4">¿Por qué elegir LEX IA?</h3>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Descubra las ventajas competitivas que LEX IA ofrece a su práctica jurídica
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                {
                  icon: Scale,
                  title: "Análisis Jurídico Avanzado",
                  description: "Procesamiento inteligente de documentos legales y jurisprudencia con precisión excepcional.",
                },
                {
                  icon: Users,
                  title: "Atención Personalizada",
                  description: "Sistema de IA que se adapta a las necesidades específicas de cada cliente y caso legal.",
                },
                {
                  icon: BookOpen,
                  title: "Base de Conocimiento Amplia",
                  description: "Acceso a una vasta biblioteca jurídica actualizada constantemente con las últimas normativas.",
                },
              ].map((feature, index) => (
                <Card key={index} className="p-8 hover:shadow-xl transition-all duration-300 border-0 bg-white/80 backdrop-blur-sm">
                  <CardContent className="p-0 text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                      <feature.icon className="w-8 h-8 text-white" />
                    </div>
                    <h4 className="text-xl font-bold text-slate-900 mb-4">{feature.title}</h4>
                    <p className="text-slate-600 leading-relaxed">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg flex items-center justify-center">
                  <Scale className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">LEX IA</h3>
                </div>
              </div>
              <p className="text-sm leading-relaxed">
                La solución de inteligencia artificial más avanzada para profesionales del derecho.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Servicios</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="hover:text-amber-400 transition-colors">
                    Análisis de Contratos
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-amber-400 transition-colors">
                    Investigación Jurídica
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-amber-400 transition-colors">
                    Redacción Automatizada
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-amber-400 transition-colors">
                    Consultoría IA
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Empresa</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="hover:text-amber-400 transition-colors">
                    Sobre Nosotros
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-amber-400 transition-colors">
                    Casos de Éxito
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-amber-400 transition-colors">
                    Blog Legal
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-amber-400 transition-colors">
                    Carreras
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Contacto</h4>
              <div className="space-y-3 text-sm">
                <div className="flex items-center space-x-2">
                  <Phone className="w-4 h-4 text-amber-400" />
                  <span>+1 (555) 123-4567</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Mail className="w-4 h-4 text-amber-400" />
                  <span>contacto@lexia.com</span>
                </div>
                <div className="flex items-center space-x-2">
                  <MapPin className="w-4 h-4 text-amber-400" />
                  <span>Madrid, España</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 text-center">
            <p className="text-sm">
              © 2025 LEX IA - Todos los derechos reservados. | Política de Privacidad | Términos de Servicio
            </p>
          </div>
        </div>
      </footer>

      {/* Elegant Floating Chatbot */}
      <div className="fixed bottom-20 right-6 z-50">
        {chatOpen ? (
          <Card className="w-96 h-[32rem] shadow-2xl border-0 rounded-2xl overflow-hidden bg-slate-900/95 backdrop-blur-sm">
            <CardContent className="p-0 flex flex-col h-full">
              {/* Chat Header */}
              <div className="bg-gradient-to-r from-slate-800 to-slate-700 p-4 flex justify-between items-center border-b border-slate-600">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-full flex items-center justify-center shadow-lg">
                    <Scale className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm">Asistente LEX IA</h3>
                    <p className="text-xs text-slate-300">Especialista en Derecho</p>
                  </div>
                </div>
                <button onClick={() => setChatOpen(false)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-slate-300" />
                </button>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-slate-800/50 to-slate-900/50">
                {messages.map((msg, idx) => (
                  <div key={idx} className="space-y-1">
                    <div
                      className={`p-3 rounded-2xl max-w-[85%] text-sm leading-relaxed shadow-lg ${
                        msg.sender === "user"
                          ? "bg-gradient-to-r from-amber-500 to-amber-600 text-white ml-auto rounded-br-md"
                          : "bg-white/95 text-slate-800 rounded-bl-md border border-slate-200"
                      }`}
                    >
                      {msg.text}
                    </div>
                    <p className={`text-xs text-slate-400 ${msg.sender === "user" ? "text-right" : "text-left"}`}>
                      {msg.timestamp}
                    </p>
                  </div>
                ))}
                {loading && (
                  <div className="flex items-center space-x-2 text-slate-400 text-sm">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                    </div>
                    <span className="italic">El asistente está escribiendo...</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 bg-slate-800/80 border-t border-slate-600">
                <div className="flex space-x-2">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Escriba su consulta legal..."
                    className="flex-1 bg-slate-700/50 border-slate-600 text-white placeholder-slate-400 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    onKeyDown={(e) => e.key === "Enter" && !loading && sendMessage()}
                    disabled={loading}
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    size="sm"
                    className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl px-4 shadow-lg disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-slate-400 mt-2 text-center">Powered by LEX IA • Respuesta segura y confidencial</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="relative group">
            <button
              onClick={() => setChatOpen(true)}
              className="flex items-center justify-center w-16 h-16 rounded-2xl shadow-2xl bg-gradient-to-br from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 transition-all duration-300 transform hover:scale-110 relative"
            >
              <MessageSquare className="w-7 h-7 text-white" />
              <div className="absolute -top-2 -right-2 w-4 h-4 bg-green-500 rounded-full border-2 border-white animate-pulse"></div>
            </button>

            {/* Tooltip */}
            <div className="absolute bottom-full right-0 mb-2 opacity-0 group-hover:opacity-100 transition-all duración-300 pointer-events-none">
              <div className="bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-xl whitespace-nowrap">
                Consulte con LEX IA
                <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-800"></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
