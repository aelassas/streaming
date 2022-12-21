import Koa from 'koa'
import sendFile from 'koa-sendfile'
import path from 'path'
import fs from 'fs'
import url from 'url'
import util from 'util'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PORT = process.env.PORT || 3000
const app = new Koa()

//
// Serve HTML page containing the video player
//
app.use(async (ctx, next) => {
    const { request } = ctx

    if (request.url === '/') {
        await sendFile(ctx, path.resolve(__dirname, 'public/index.html'))
    }

    return next()
})

//
// Serve video streaming
//
app.use(async ({ request, response }, next) => {

    if (
        !request.url.startsWith('/api/video') ||
        !request.query.name ||
        !request.query.name.match(/^[a-z0-9-_]+\.(mp4)$/i)
    ) {
        return next()
    }

    const range = request.headers.range

    if (!range) {
        response.status = 400
        response.body = 'Range must be provided'
        return next()
    }

    const name = request.query.name
    const videoPath = path.resolve(__dirname, 'videos', name)

    try {
        await util.promisify(fs.access)(videoPath)
    } catch (err) {
        if (err.code === 'ENOENT') {
            response.status = 404
            response.body = `File ${name} not found`
        } else {
            response.status = 500
            response.body = `An error occured while trying to access the file ${name}`
        }
        console.log(err.toString())
        return next()
    }

    const parts = range.replace('bytes=', '').split('-')
    const start = parseInt(parts[0], 10)
    const videoStat = await util.promisify(fs.stat)(videoPath)
    const videoSize = videoStat.size
    const chunkSize = 10 ** 6 // 1mb
    const end = Math.min(start + chunkSize, videoSize) - 1 // We remove 1 because start and end start from 0
    const contentLength = end - start + 1 // We add 1 because start and end start from 0

    response.set('Content-Range', `bytes ${start}-${end}/${videoSize}`)
    response.set('Accept-Range', 'bytes')
    response.set('Content-Length', contentLength)

    response.status = 206
    response.type = path.extname(name)
    response.body = fs.createReadStream(videoPath, { start, end })
    return next()
})

//
// We ignore ECONNRESET and ECANCELED errors because when 
// the browser closes the connection, the server tries
// to read the stream. So, the server says that it cannot 
// read a closed stream.
//
app.on('error', (err) => {
    if (!['ECONNRESET', 'ECANCELED'].includes(err.code)) {
        console.log(err.toString())
    }
})

//
// Start the server on the specified PORT
//
app.listen(PORT)