package kr.potatosalad775.unipeq.deviceio

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbRequest
import android.os.Build
import java.io.IOException
import java.nio.ByteBuffer
import kotlin.concurrent.thread

/**
 * One claimed HID interface. Moves raw report bytes and nothing else: report ids, padding and
 * descriptor parsing are the TS wrapper's job (src/transports/native/), so the plugin never
 * learns a protocol.
 *
 * Byte shapes follow the USB HID spec: a numbered report carries its id as the first byte, on
 * the interrupt pipes and in SET_REPORT / GET_REPORT data alike.
 */
internal class UsbHidConnection(
    val device: UsbDevice,
    private val connection: UsbDeviceConnection,
    private val iface: UsbInterface,
    private val onInput: (ByteArray) -> Unit
) {
    val inEndpoint: UsbEndpoint? = interruptEndpoint(iface, UsbConstants.USB_DIR_IN)
    val outEndpoint: UsbEndpoint? = interruptEndpoint(iface, UsbConstants.USB_DIR_OUT)

    @Volatile
    private var running = true
    private var request: UsbRequest? = null

    init {
        inEndpoint?.let { ep -> thread(name = "UsbHid-in-${iface.id}", isDaemon = true) { readLoop(ep) } }
    }

    private fun readLoop(ep: UsbEndpoint) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // A queued UsbRequest stays armed between reports, so nothing is lost between two waits.
            val req = UsbRequest()
            if (!req.initialize(connection, ep)) return
            request = req
            val buffer = ByteBuffer.allocate(ep.maxPacketSize)
            while (running) {
                buffer.clear()
                if (!req.queue(buffer)) break
                val done = try {
                    connection.requestWait()
                } catch (_: Exception) {
                    null
                } ?: break
                if (done !== req || !running) continue
                val n = buffer.position()
                if (n > 0) onInput(buffer.array().copyOf(n))
            }
            req.close()
        } else {
            val buffer = ByteArray(ep.maxPacketSize)
            while (running) {
                val n = connection.bulkTransfer(ep, buffer, buffer.size, READ_POLL_MS)
                if (n > 0) onInput(buffer.copyOf(n))
            }
        }
    }

    /** Output report: interrupt OUT when the interface has one, else SET_REPORT on endpoint 0. */
    fun sendReport(reportId: Int, data: ByteArray) {
        val payload = withId(reportId, data)
        val out = outEndpoint
        val n = if (out != null) {
            connection.bulkTransfer(out, payload, payload.size, IO_TIMEOUT_MS)
        } else {
            setReport(REPORT_TYPE_OUTPUT, reportId, payload)
        }
        if (n != payload.size) throw IOException("sendReport: sent $n of ${payload.size} bytes")
    }

    fun sendFeatureReport(reportId: Int, data: ByteArray) {
        val payload = withId(reportId, data)
        val n = setReport(REPORT_TYPE_FEATURE, reportId, payload)
        if (n != payload.size) throw IOException("sendFeatureReport: sent $n of ${payload.size} bytes")
    }

    /** GET_REPORT (feature) as the device answers it: report id first on numbered reports. */
    fun receiveFeatureReport(reportId: Int, length: Int): ByteArray {
        val buffer = ByteArray(length)
        val n = connection.controlTransfer(
            REQUEST_TYPE_CLASS_IN, GET_REPORT, (REPORT_TYPE_FEATURE shl 8) or reportId, iface.id,
            buffer, length, IO_TIMEOUT_MS
        )
        if (n < 0) throw IOException("receiveFeatureReport: transfer failed")
        return buffer.copyOf(n)
    }

    fun close() {
        running = false
        request?.cancel()
        connection.releaseInterface(iface)
        connection.close()
    }

    private fun setReport(type: Int, reportId: Int, payload: ByteArray) = connection.controlTransfer(
        REQUEST_TYPE_CLASS_OUT, SET_REPORT, (type shl 8) or reportId, iface.id,
        payload, payload.size, IO_TIMEOUT_MS
    )

    companion object {
        private const val IO_TIMEOUT_MS = 1000
        private const val READ_POLL_MS = 250
        private const val REQUEST_TYPE_CLASS_OUT = 0x21
        private const val REQUEST_TYPE_CLASS_IN = 0xA1
        private const val GET_REPORT = 0x01
        private const val SET_REPORT = 0x09
        private const val REPORT_TYPE_OUTPUT = 2
        private const val REPORT_TYPE_FEATURE = 3

        private fun withId(reportId: Int, data: ByteArray) =
            if (reportId == 0) data else byteArrayOf(reportId.toByte()) + data

        private fun interruptEndpoint(iface: UsbInterface, direction: Int): UsbEndpoint? =
            (0 until iface.endpointCount).map(iface::getEndpoint).firstOrNull {
                it.type == UsbConstants.USB_ENDPOINT_XFER_INT && it.direction == direction
            }

        fun hidInterfaces(device: UsbDevice): List<UsbInterface> =
            (0 until device.interfaceCount).map(device::getInterface)
                .filter { it.interfaceClass == UsbConstants.USB_CLASS_HID }
                .distinctBy { it.id }

        /**
         * The interface's report descriptor (GET_DESCRIPTOR, type 0x22), or null if the device
         * doesn't give it. The interface must be claimed on `connection`.
         */
        fun readReportDescriptor(connection: UsbDeviceConnection, iface: UsbInterface): ByteArray? {
            val length = reportDescriptorLength(connection.rawDescriptors, iface.id) ?: 4096
            val buffer = ByteArray(length)
            val n = connection.controlTransfer(0x81, 0x06, 0x2200, iface.id, buffer, length, IO_TIMEOUT_MS)
            return if (n > 0) buffer.copyOf(n) else null
        }

        /** wDescriptorLength of the report descriptor, from the HID class descriptor (0x21). */
        private fun reportDescriptorLength(raw: ByteArray?, interfaceNumber: Int): Int? {
            if (raw == null) return null
            fun u8(i: Int) = raw[i].toInt() and 0xff
            var i = 0
            var current = -1
            while (i + 1 < raw.size) {
                val len = u8(i)
                if (len < 2 || i + len > raw.size) break
                when (u8(i + 1)) {
                    0x04 -> current = u8(i + 2)
                    0x21 -> if (current == interfaceNumber && len >= 9) {
                        for (k in 0 until u8(i + 5)) {
                            val o = i + 6 + k * 3
                            if (o + 2 < i + len && u8(o) == 0x22) return u8(o + 1) or (u8(o + 2) shl 8)
                        }
                    }
                }
                i += len
            }
            return null
        }
    }
}
