import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function localStatementBridgePlugin(): Plugin {
  return {
    name: 'local-statement-bridge',
    configureServer(server) {
      server.middlewares.use('/api/local-statement', (req, res, next) => {
        if (req.method === 'GET') {
          try {
            const downloadsDir = path.join(os.homedir(), 'Downloads')
            if (!fs.existsSync(downloadsDir)) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Downloads directory not found' }))
              return
            }

            const files = fs.readdirSync(downloadsDir)
            const statementFiles = files.filter(
              (f) =>
                (f.toLowerCase().includes('phonepe') || f.toLowerCase().includes('statement')) &&
                (f.toLowerCase().endsWith('.pdf') || f.toLowerCase().endsWith('.csv'))
            )

            const targetFile =
              statementFiles.find((f) => f === 'PhonePe_Statement_Jul2026_Oct2026.pdf') || statementFiles[0]

            if (!targetFile) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'No statement file found in Downloads' }))
              return
            }

            const filePath = path.join(downloadsDir, targetFile)
            const stat = fs.statSync(filePath)
            const buffer = fs.readFileSync(filePath)
            const base64 = buffer.toString('base64')

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                success: true,
                fileName: targetFile,
                fileSize: stat.size,
                base64,
              })
            )
          } catch (err: any) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        } else {
          next()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localStatementBridgePlugin()],
})
