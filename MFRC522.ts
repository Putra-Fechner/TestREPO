//% color="#275C6B" weight=100 icon="↔" block="MFRC522 NTAG"
namespace MFRC522 {
    const RequestCommand = 0x26
    const ReadCommand = 0x30
    const WriteCommand = 0xA2

    const CommandReg = 0x01
    const ComIEnReg = 0x02
    const DivIEnReg = 0x03
    const ComIrqReg = 0x04
    const FIFOLevelReg = 0x0A
    const FIFODataReg = 0x09
    const BitFramingReg = 0x0D
    const ControlReg = 0x0C
    const ErrorReg = 0x06
    const TxControlReg = 0x14
    const CRCResultRegH = 0x21
    const CRCResultRegL = 0x22

    const PCD_IDLE = 0x00
    const PCD_CALCCRC = 0x03
    const PCD_TRANSCEIVE = 0x0C
    const PCD_RESETPHASE = 0x0F

    const MAX_LEN = 16

    function spiWrite(addr: number, val: number): void {
        pins.digitalWritePin(DigitalPin.P16, 0)
        pins.spiWrite((addr << 1) & 0x7E)
        pins.spiWrite(val)
        pins.digitalWritePin(DigitalPin.P16, 1)
    }

    function spiRead(addr: number): number {
        pins.digitalWritePin(DigitalPin.P16, 0)
        pins.spiWrite(((addr << 1) & 0x7E) | 0x80)
        let val = pins.spiWrite(0)
        pins.digitalWritePin(DigitalPin.P16, 1)
        return val
    }

    function setBitMask(reg: number, mask: number): void {
        let tmp = spiRead(reg)
        spiWrite(reg, tmp | mask)
    }

    function clearBitMask(reg: number, mask: number): void {
        let tmp = spiRead(reg)
        spiWrite(reg, tmp & (~mask))
    }

    function calculateCRC(data: number[]): number[] {
        spiWrite(CommandReg, PCD_IDLE)
        clearBitMask(DivIEnReg, 0x04)
        setBitMask(FIFOLevelReg, 0x80)

        for (let i = 0; i < data.length; i++) {
            spiWrite(FIFODataReg, data[i])
        }

        spiWrite(CommandReg, PCD_CALCCRC)

        let i = 255
        while (true) {
            let n = spiRead(DivIEnReg)
            i--
            if ((i === 0) || (n & 0x04)) break
        }

        return [spiRead(CRCResultRegL), spiRead(CRCResultRegH)]
    }

    function toCard(command: number, sendData: number[]): [boolean, number[], number] {
        let backData: number[] = []
        let backLen = 0
        let status = false

        spiWrite(CommandReg, PCD_IDLE)
        setBitMask(FIFOLevelReg, 0x80)
        clearBitMask(ComIrqReg, 0x80)
        spiWrite(ComIEnReg, 0x77)

        for (let i = 0; i < sendData.length; i++) {
            spiWrite(FIFODataReg, sendData[i])
        }

        spiWrite(CommandReg, command)
        if (command === PCD_TRANSCEIVE) {
            setBitMask(BitFramingReg, 0x80)
        }

        let i = 2000
        while (true) {
            let n = spiRead(ComIrqReg)
            i--
            if (i === 0 || (n & 0x30)) break
        }

        clearBitMask(BitFramingReg, 0x80)

        let error = spiRead(ErrorReg)
        if ((error & 0x1B) === 0) {
            status = true
            if (command === PCD_TRANSCEIVE) {
                let n = spiRead(FIFOLevelReg)
                for (let i = 0; i < n; i++) {
                    backData.push(spiRead(FIFODataReg))
                }
                backLen = n
            }
        }

        return [status, backData, backLen]
    }

    function detectCard(): boolean {
        spiWrite(BitFramingReg, 0x07)
        let [status, backData, backLen] = toCard(PCD_TRANSCEIVE, [RequestCommand])
        return status && backLen === 2
    }

    /**
     * Initialize MFRC522 reader
     */
    //% block="initialize MFRC522 reader"
    export function Init(): void {
        pins.spiPins(DigitalPin.P15, DigitalPin.P14, DigitalPin.P13)
        pins.spiFormat(8, 0)
        pins.spiFrequency(1000000)
        pins.digitalWritePin(DigitalPin.P16, 1)

        // Full reset sequence
        spiWrite(CommandReg, PCD_RESETPHASE)
        spiWrite(0x2A, 0x8D)
        spiWrite(0x2B, 0x3E)
        spiWrite(0x2D, 30)
        spiWrite(0x2E, 0)
        spiWrite(0x15, 0x40)
        spiWrite(0x11, 0x3D)

        // Antenna on
        setBitMask(TxControlReg, 0x03)
    }

    /**
     * Write data to NTAG213 tag
     * Max 48 characters (3 pages)
     */
    //% block="write %text to tag"
    export function write(text: string): boolean {
        if (!detectCard()) return false

        let data: number[] = []
        for (let i = 0; i < text.length && i < 48; i++) {
            data.push(text.charCodeAt(i))
        }
        while (data.length < 48) data.push(32)

        for (let page = 4; page < 7; page++) {
            let buffer = [WriteCommand, page]
            let chunk = data.slice((page - 4) * 16, (page - 3) * 16).slice(0, 4)
            buffer = buffer.concat(chunk)
            let crc = calculateCRC(buffer)
            buffer = buffer.concat(crc)

            let [ok, _, __] = toCard(PCD_TRANSCEIVE, buffer)
            if (!ok) return false
        }

        return true
    }

    /**
     * Read 3 pages (48 characters) from NTAG213 tag
     */
    //% block="read data from tag"
    export function read(): string {
        if (!detectCard()) return ""

        let result = ""
        for (let page = 4; page < 7; page++) {
            let buffer = [ReadCommand, page]
            let crc = calculateCRC(buffer)
            buffer = buffer.concat(crc)

            let [ok, backData, _] = toCard(PCD_TRANSCEIVE, buffer)
            if (ok && backData.length >= 16) {
                for (let i = 0; i < 4; i++) {
                    result += String.fromCharCode(backData[i])
                }
            } else {
                return ""
            }
        }

        return result
    }
}
