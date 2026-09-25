# AI Habit Tracker (clone de estudo)

Clone do projeto do vídeo **"Build a Full-Stack AI-Powered Habit Tracker App"** (canal Time To Program): frontend do boilerplate do autor + backend reconstruído neste projeto.

## Stack

- **Frontend:** React 19, Vite, Tailwind CSS 4, Recharts, React Router (boilerplate do canal)
- **Backend:** Node.js, Express, MongoDB (Mongoose), JWT (`jsonwebtoken` + `bcryptjs`), Google Gemini (`@google/genai`; modelo configurável em `GEMINI_MODEL`, padrão `gemini-3.8-flash`)
- **Banco:** MongoDB 8 em Docker (porta local 27018)

## Pré-requisitos

- Node.js 22+ e npm
- Docker com o daemon rodando

## Como rodar

```bash
docker compose up -d            # MongoDB local (porta 27018)
cd backend
npm install
npm run seed                    # usuário demo + 8 hábitos + ~500 check-ins
npm run dev                     # API em http://localhost:8000

cd ../frontend
npm install
npm run dev                     # app em http://localhost:5173
```

## Login demo (seed)

- **E-mail:** `alex@example.com`
- **Senha:** `password123`

## IA (opcional)

As 5 features de IA (relatório semanal, sugestão de hábitos, plano de recuperação de streak, chat de análise e motivação matinal) usam a API do Google Gemini. **Sem chave, o app funciona normalmente** e a IA responde com uma mensagem amigável. Para ativar:

1. Crie uma chave gratuita em <https://aistudio.google.com/apikey> (sem cartão de crédito)
2. Coloque em `backend/.env`: `GEMINI_API_KEY=sua_chave`
3. Reinicie o backend

> Obs.: o tier grátis do Gemini limita ~20 requisições/dia por modelo. Veja seu uso em <https://ai.dev/rate-limit>.

## Scripts (backend)

| Comando | O que faz |
|---|---|
| `npm run dev` | API com reload automático (nodemon) |
| `npm run seed` | Recria os dados de demonstração |
| `npm test` | Testes (Node test runner + supertest; requer Docker no ar) |
| `npm run smoke` | Verificação de contrato contra o servidor rodando |

## Variáveis de ambiente

`backend/.env` (veja `.env.example`):

| Variável | Valor padrão |
|---|---|
| `PORT` | `8000` |
| `MONGO_URI` | `mongodb://localhost:27018/ai-habit-tracker` |
| `JWT_SECRET` | gerado localmente (`crypto.randomBytes(64).toString("hex")`) |
| `GEMINI_API_KEY` | vazio (IA desativada) |
| `GEMINI_MODEL` | `gemini-3.8-flash` |
| `CLIENT_URL` | `http://localhost:5173` |

`frontend/.env`:

| Variável | Valor |
|---|---|
| `VITE_API_URL` | `http://localhost:8000/api` |

## Portas

| Serviço | Porta |
|---|---|
| Frontend (Vite) | 5173 |
| Backend (Express) | 8000 |
| MongoDB (Docker) | 27018 |

## Créditos e uso

- Vídeo: Time To Program — "Build a Full-Stack AI-Powered Habit Tracker App" (<https://www.youtube.com/watch?v=PO-UZsQnkNU>)
- Frontend: boilerplate público do canal (<https://github.com/time-to-program/ai-habit-tracker-ui-boilerplate-code>) — **sem arquivo LICENSE**; este clone é para uso pessoal/estudo, sem redistribuição.
- Backend: reconstruído neste projeto a partir do contrato do frontend (mock do boilerplate) e do conteúdo do vídeo.
