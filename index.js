import Koa from 'koa'
import KoaRouter from 'koa-router'
import sendFile from 'koa-sendfile'
import url from 'url'
import path from 'path'
import fs from 'fs'
import util from 'util'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = parseInt(process.env.PORT, 10) || 3000
const app = new Koa()
const router = new KoaRouter()

//
// Serve HTML page containing the video player
//
router.get('/', async (ctx) => {
    await sendFile(ctx, path.resolve(__dirname, 'public', 'index.html'))

    if (!ctx.status) {
        ctx.throw(404)
    }
})

//
// Serve video streaming
//
router.get('/api/video/:name', async (ctx, next) => {
    const { name } = ctx.params

    if (
        !/^[a-z0-9-_ ]+\.mp4$/i.test(name)
    ) {
        return next()
    }

    const { request, response } = ctx
    const { range } = request.headers

    if (!range) {
        ctx.throw(400, 'Range not provided')
    }

    const videoPath = path.resolve(__dirname, 'videos', name)

    try {
        await util.promisify(fs.access)(videoPath)
    } catch (err) {
        if (err.code === 'ENOENT') {
            ctx.throw(404)
        } else {
            ctx.throw(err.toString())
        }
    }

    //
    // Calculate start Content-Range
    //
    const parts = range.replace('bytes=', '').split('-')
    const rangeStart = parts[0] && parts[0].trim()
    const start = rangeStart ? parseInt(rangeStart, 10) : 0

    //
    // Calculate video size and chunk size
    //
    const videoStat = await util.promisify(fs.stat)(videoPath)
    const videoSize = videoStat.size
    const chunkSize = 10 ** 6 // 1mb

    //
    // Calculate end Content-Range
    //
    // Safari/iOS first sends a request with bytes=0-1 range HTTP header
    // probably to find out if the server supports byte ranges
    //
    const rangeEnd = parts[1] && parts[1].trim()
    const __rangeEnd = rangeEnd ? parseInt(rangeEnd, 10) : undefined
    const end = __rangeEnd === 1 ? __rangeEnd : (Math.min(start + chunkSize, videoSize) - 1) // We remove 1 byte because start and end start from 0
    const contentLength = end - start + 1 // We add 1 byte because start and end start from 0

    response.set('Content-Range', `bytes ${start}-${end}/${videoSize}`)
    response.set('Accept-Ranges', 'bytes')
    response.set('Content-Length', contentLength)

    const stream = fs.createReadStream(videoPath, { start, end })
    stream.on('error', (err) => {
        console.log(err.toString())
    })

    response.status = 206
    response.type = path.extname(name)
    response.body = stream
})

//
// We ignore ECONNRESET, ECANCELED and ECONNABORTED errors
// because when the browser closes the connection, the server
// tries to read the stream. So, the server says that it cannot
// read a closed stream.
//
app.on('error', (err) => {
    if (!['ECONNRESET', 'ECANCELED', 'ECONNABORTED'].includes(err.code)) {
        console.log(err.toString())
    }
})

//
// Add Koa Router middleware
//
app.use(router.routes())
app.use(router.allowedMethods())

//
// Start the server on the specified PORT
//
app.listen(PORT)
console.log('Video Streaming Server is running on Port', PORT)